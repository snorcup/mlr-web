const PACKET_LENGTHS = new Map([[0x00,3],[0x01,33],[0x03,3],[0x20,3],[0x21,3],[0x50,3],[0x51,2],[0x52,2]]);

// Bridge runs on the local machine (where the browser and monome are)
const SOSC_WS_HOST = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? 'localhost'
  : 'localhost';
const SOSC_WS_PORT = 8089;
const SOSC_WS_PATH = `ws://${SOSC_WS_HOST}:${SOSC_WS_PORT}`;

export class MonomeBridge {
  constructor({onKey=()=>{}, onStatus=()=>{}, rows=8, cols=16} = {}){
    this.rows=rows; this.cols=cols;
    this.onKey = onKey;
    this.onStatus = onStatus;
    this.ws = null;
    this.connected = false;
    this.frame = Array.from({length:rows}, ()=>Array(cols).fill(0));
    this.retryTimer = null;
  }
  get supported(){ return true; /* WebSocket always available */ }

  async connect(){
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SOSC_WS_PATH);
      this.ws = ws;
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Bridge connection timeout')); }, 5000);

      ws.onopen = () => {
        console.log('[monome] bridge connected');
        this.onStatus('bridge connected');
        // Discover devices
        ws.send(JSON.stringify({type:'discover'}));
        // Wait for device reply — poll every 500ms
        const check = setInterval(() => {
          if(this._devicePort){
            clearInterval(check);
            clearTimeout(timeout);
            ws.send(JSON.stringify({type:'connect', port: this._devicePort}));
          }
        }, 500);
        // Give up after 10s
        setTimeout(() => {
          if(!this.connected){ clearInterval(check); clearTimeout(timeout); ws.close(); reject(new Error('No monome device found')); }
        }, 10000);
      };

      ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }
        console.log('[monome] bridge <-', msg.type, msg);
        switch(msg.type){
          case 'device':
            this._devicePort = msg.port;
            this._deviceId = msg.id;
            this._deviceName = msg.name;
            console.log(`[monome] device found: ${msg.id} "${msg.name}" port ${msg.port}`);
            break;
          case 'status':
            if(msg.msg.startsWith('connected')){
              this.connected = true;
              this.onStatus('connected: ' + this._deviceName);
              this._pushFrame();
              resolve();
            }
            break;
          case 'key':
            this.onKey({x: msg.x, y: msg.y, z: msg.z, state: msg.z === 1});
            break;
        }
      };

      ws.onerror = (e) => { console.error('[monome] bridge error:', e); };
      ws.onclose = () => {
        clearTimeout(timeout);
        this.connected = false;
        this.onStatus('disconnected');
        // Auto-retry
        if(!this._manualDisconnect){
          this.retryTimer = setTimeout(() => this.connect().catch(()=>{}), 3000);
        }
      };
    });
  }

  async disconnect(){
    this._manualDisconnect = true;
    clearTimeout(this.retryTimer);
    if(this.ws){ this.ws.close(); this.ws = null; }
    this.connected = false;
    this.onStatus('disconnected');
  }

  _send(obj){ if(this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  async send(bytes){ /* legacy compat — not used with bridge */ }
  async clear(){ this.frame.forEach(r=>r.fill(0)); this._send({type:'led_all', s:0}); this._pushFrame(); }
  async all(on){ this.frame.forEach(r=>r.fill(on?15:0)); this._send({type:'led_all', s:on?15:0}); }

  async ledSet(x,y,on){
    if(x<0||x>=this.cols||y<0||y>=this.rows) return;
    this.frame[y][x]=on?15:0;
    this._send({type:'led_set', x, y, s:on?15:0});
  }

  async levelSet(x,y,level){
    if(x<0||x>=this.cols||y<0||y>=this.rows) return;
    const l=Math.max(0,Math.min(15,level|0));
    this.frame[y][x]=l;
    this._send({type:'led_level_set', x, y, level:l});
  }

  async intensity(level){ /* global intensity — not implemented via bridge */ }

  async draw(frame){
    // Use OSC led/map for bulk updates — convert framebuffer to 8 rows of 8-bit values
    // For 16-col grid, we need 8 rows, each is 16 bits (2 bytes)
    // monome /led/level/map expects: x_offset y_offset row0 row1 ... row7
    // where each row is 8-bit. For 16-wide we need two maps or use individual set calls.
    // For efficiency use level/set for changed cells only.
    for(let y=0;y<this.rows;y++){
      for(let x=0;x<this.cols;x++){
        const next = Math.max(0,Math.min(15,frame[y]?.[x] ?? 0));
        if(next !== this.frame[y][x]){
          this.frame[y][x] = next;
          this._send({type:'led_level_set', x, y, level:next});
        }
      }
    }
  }

  _pushFrame(){
    for(let y=0;y<this.rows;y++){
      for(let x=0;x<this.cols;x++){
        const v = this.frame[y][x];
        if(v > 0) this._send({type:'led_level_set', x, y, level:v});
      }
    }
  }
}

export class MonomeSerial {
  constructor({onKey=()=>{}, onStatus=()=>{}, rows=8, cols=16} = {}){
    this.rows=rows; this.cols=cols;
    this.port = null; this.reader = null; this.writer = null; this.onKey = onKey; this.onStatus = onStatus; this.frame = Array.from({length:rows},()=>Array(cols).fill(0)); this.reading = false; this.autoGranted = false;
  }
  get supported(){ return 'serial' in navigator; }
  async connect(){
    if (!this.supported) throw new Error('Web Serial API is not available. Use Chrome/Edge on localhost or HTTPS.');
    // Try ports user already granted permission for — avoids the picker entirely on reconnect
    const granted = await navigator.serial.getPorts();
    if (granted.length === 1) {
      this.port = granted[0];
      this.autoGranted = true;
    } else if (granted.length > 1) {
      // Multiple previously granted — try each one
      this.port = granted[0];
      this.autoGranted = true;
    } else {
      // No previously granted ports — show picker without filters (most reliable)
      try {
        this.port = await navigator.serial.requestPort();
      } catch (e) {
        if (e?.name === 'NotFoundError' || e?.message?.includes('No port selected')) {
          throw new Error('Serial port picker was cancelled.');
        }
        throw e;
      }
    }
    if (!this.port) throw new Error('No serial port was selected.');
    const info = this.port.getInfo();
    console.log('[monome] opening port:', info.usbVendorId?.toString(16), info.usbProductId?.toString(16));
    // Older monome grids default to 9600 baud — try 9600 first
    const baudRates = [9600, 115200];
    let opened = false;
    let actualBaud = 9600;
    for (const baud of baudRates) {
      try {
        await this.port.close().catch(()=>{});
      } catch(e) {}
      try {
        await this.port.open({baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'});
        console.log('[monome] opened at', baud, 'baud');
        actualBaud = baud;
        opened = true;
        break;
      } catch(e) {
        console.log('[monome] failed at', baud, ':', e.message);
      }
    }
    if (!opened) throw new Error('Could not open serial port at any baud rate');
    // Log port info and open options that were accepted
    const portInfo = this.port.getInfo();
    console.log('[monome] VID:', portInfo.usbVendorId?.toString(16), 'PID:', portInfo.usbProductId?.toString(16));
    this.writer = this.port.writable.getWriter();
    this.onStatus('connected 9600');
    // Start read loop FIRST (before any writes) to catch startup data
    this.readLoop();
    // Small delay then send init commands
    await new Promise(r => setTimeout(r, 300));
    await this.send([0x00]); // system query
    console.log('[monome] sent system query 0x00');
    await new Promise(r => setTimeout(r, 200));
  }
  async disconnect(){
    this.reading = false;
    try { await this.reader?.cancel(); } catch {}
    this.reader?.releaseLock?.(); this.writer?.releaseLock?.();
    if (this.port) await this.port.close();
    this.port = this.reader = this.writer = null; this.onStatus('disconnected');
  }
  async send(bytes){
    if (!this.writer) return;
    await this.writer.write(new Uint8Array(bytes));
  }
  async clear(){ await this.send([0x12]); this.frame.forEach(row=>row.fill(0)); }
  async all(on){ await this.send([on?0x13:0x12]); this.frame.forEach(row=>row.fill(on?15:0)); }
  async ledSet(x,y,on){ if(x<0||x>=this.cols||y<0||y>=this.rows)return; this.frame[y][x]=on?15:0; await this.send([on?0x11:0x10,x,y]); }
  async levelSet(x,y,level){ if(x<0||x>=this.cols||y<0||y>=this.rows)return; const l=Math.max(0,Math.min(15,level|0)); this.frame[y][x]=l; await this.send([0x18,x,y,l]); }
  async intensity(level){ await this.send([0x17, Math.max(0,Math.min(15,level|0))]); }
  async draw(frame){
    for(let y=0;y<this.rows;y++) for(let x=0;x<this.cols;x++){
      const next = Math.max(0,Math.min(15,frame[y]?.[x] ?? 0));
      if(next !== this.frame[y][x]) await this.levelSet(x,y,next);
    }
  }
  async readLoop(){
    this.reading = true; this.reader = this.port.readable.getReader(); let buf=[]; let bytesReceived=0; let readCount=0;
    try{
      while(this.reading){
        const {value,done}=await this.reader.read(); if(done) break; if(!value) continue;
        bytesReceived += value.length;
        readCount++;
        const hex = [...value].map(b=>b.toString(16).padStart(2,'0')).join(' ');
        console.log('[monome] #' + readCount + ' [' + value.length + ']: ' + hex);
        for(const byte of value){ buf.push(byte); buf=this.parse(buf); }
      }
    } catch(err){ this.onStatus(`error: ${err.message}`); }
    console.log('[monome] readLoop ended, total reads:', readCount, 'bytes:', bytesReceived);
  }
  parse(buf){
    while(buf.length){
      const cmd=buf[0]; const len=PACKET_LENGTHS.get(cmd);
      if(!len){ buf.shift(); continue; }
      if(buf.length < len) return buf;
      const packet=buf.splice(0,len);
      if(cmd===0x20 || cmd===0x21) this.onKey({x:packet[1], y:packet[2], state:cmd===0x21});
    }
    return buf;
  }
}

export function parseMonomePackets(bytes){
  const events=[]; const driver={onKey:e=>events.push(e)};
  let buf=[];
  const parse = MonomeSerial.prototype.parse.bind(driver);
  for(const b of bytes) buf=parse([...buf,b]);
  return events;
}
