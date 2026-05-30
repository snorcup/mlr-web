const PACKET_LENGTHS = new Map([[0x00,3],[0x01,33],[0x03,3],[0x20,3],[0x21,3],[0x50,3],[0x51,2],[0x52,2]]);

export class MonomeSerial {
  constructor({onKey=()=>{}, onStatus=()=>{}, rows=8, cols=16} = {}){
    this.rows=rows; this.cols=cols;
    this.port = null; this.reader = null; this.writer = null; this.onKey = onKey; this.onStatus = onStatus; this.frame = Array.from({length:rows},()=>Array(cols).fill(0)); this.reading = false;
  }
  get supported(){ return 'serial' in navigator; }
  async connect(){
    if (!this.supported) throw new Error('Web Serial API is not available. Use Chrome/Edge on localhost or HTTPS.');
    const filters = [{ usbVendorId: 0x0403 }]; // FTDI devices used by monome classic
    this.port = await navigator.serial.requestPort({filters});
    await this.port.open({baudRate:115200});
    this.writer = this.port.writable.getWriter();
    this.onStatus('connected');
    await this.clear();
    await this.send([0x00]); // system query
    this.readLoop();
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
    this.reading = true; this.reader = this.port.readable.getReader(); let buf=[];
    try{
      while(this.reading){
        const {value,done}=await this.reader.read(); if(done) break; if(!value) continue;
        for(const byte of value){ buf.push(byte); buf=this.parse(buf); }
      }
    } catch(err){ this.onStatus(`error: ${err.message}`); }
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
