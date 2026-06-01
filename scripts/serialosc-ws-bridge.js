#!/usr/bin/env node
/**
 * serialosc-ws-bridge.js
 *
 * WebSocket <-> serialosc bridge. Lets the browser UI talk to a monome grid
 * via serialosc's UDP OSC protocol.
 *
 * Usage:
 *   node serialosc-ws-bridge.js
 *
 * The browser connects to ws://localhost:8089 and sends JSON:
 *
 *   -> {"type":"discover"}               query serialosc for devices
 *   <- {"type":"device","id":"m..","name":"monome 128","port":10873}
 *
 *   -> {"type":"connect","port":10873}   attach to device, init OSC routing
 *   <- {"type":"status","msg":"connected to m128-386 on port 10873"}
 *
 *   <- {"type":"key","x":9,"y":3,"z":1}   grid key event from monome
 *
 *   -> {"type":"led_set","x":2,"y":2,"s":8}
 *   -> {"type":"led_all","s":0}
 *
 * Environment:
 *   SERIALOSC_WS_PORT   WebSocket port  (default 8089)
 *   SERIALOSC_UDP_PORT  serialosc supervisor port (default 12002)
 */

import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const WS_PORT = parseInt(process.env.SERIALOSC_WS_PORT) || 8089;
const SOSC_PORT = parseInt(process.env.SERIALOSC_UDP_PORT) || 12002;
const HOST = '127.0.0.1';

// --- OSC encoding/decoding ---

function pad4(n) { return (n + 3) & ~3; }

function encodeOsc(path, args = []) {
  // path
  const pLen = pad4(path.length + 1);
  const pathBuf = Buffer.alloc(pLen);
  pathBuf.write(path);

  // type tag
  let tt = ',';
  const argBufs = [];
  for (const a of args) {
    if (typeof a === 'number' && Number.isInteger(a)) {
      tt += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a);
      argBufs.push(b);
    } else if (typeof a === 'number') {
      tt += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      argBufs.push(b);
    } else {
      tt += 's';
      const s = Buffer.from(String(a));
      const sLen = pad4(s.length + 1);
      const sBuf = Buffer.alloc(sLen);
      sBuf.fill(0);
      s.copy(sBuf);
      argBufs.push(sBuf);
    }
  }
  const ttLen = pad4(tt.length + 1);
  const ttBuf = Buffer.alloc(ttLen);
  ttBuf.write(tt);
  return Buffer.concat([pathBuf, ttBuf, ...argBufs]);
}

function decodeOsc(buf) {
  const addrEnd = buf.indexOf(0);
  const address = buf.slice(0, addrEnd).toString('ascii');
  let pos = pad4(addrEnd + 1);
  const ttEnd = buf.indexOf(0, pos);
  const types = buf.slice(pos + 1, ttEnd).toString('ascii');
  pos = pad4(ttEnd + 1);
  const args = [];
  for (const t of types) {
    if (t === 'i') { args.push(buf.readInt32BE(pos)); pos += 4; }
    else if (t === 'f') { args.push(buf.readFloatBE(pos)); pos += 4; }
    else if (t === 's') {
      const end = buf.indexOf(0, pos);
      args.push(buf.slice(pos, end).toString('ascii'));
      pos = pad4(end + 1);
    }
  }
  return { address, args };
}

// --- State ---

let devicePort = null;       // per-device OSC port (from /serialosc/device reply)
let connected = false;       // true after /sys/host + /sys/port + /sys/prefix
let oscSocket = null;        // our UDP socket for sending/receiving OSC
let wsClients = new Set();

function oscSend(path, args) {
  if (!oscSocket) return;
  const msg = encodeOsc(path, args);
  oscSocket.send(msg, devicePort || SOSC_PORT, HOST);
}

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of wsClients) { try { ws.send(s); } catch {} }
}

// --- OSC UDP listener ---

function startOscSocket() {
  oscSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  oscSocket.bind(0, HOST, () => {
    const addr = oscSocket.address();
    console.log(`[bridge] OSC UDP listening on ${HOST}:${addr.port}`);
  });
  oscSocket.on('message', (msg) => {
    try {
      const { address, args } = decodeOsc(msg);
      if (address === '/serialosc/device') {
        const dev = { id: args[0], name: args[1], port: args[2] };
        console.log(`[bridge] device: ${dev.id} "${dev.name}" port ${dev.port}`);
        broadcast({ type: 'device', ...dev });
      } else if (address.endsWith('/grid/key')) {
        const [x, y, s] = args;
        broadcast({ type: 'key', x, y, z: s });
      } else if (address.startsWith('/serialosc/')) {
        console.log(`[bridge] serialosc: ${address}`, args);
      }
    } catch (e) { /* ignore malformed */ }
  });
}

// --- WebSocket server ---

function setupWs() {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    console.log('[bridge] WS client connected');
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: 'status', msg: 'bridge ready' }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      console.log('[bridge] WS ->', msg.type, msg);

      switch (msg.type) {
        case 'discover': {
          // Query serialosc supervisor for connected devices
          oscSend('/serialosc/list', ['s', HOST, 'i', oscSocket.address().port]);
          break;
        }
        case 'connect': {
          devicePort = msg.port;
          const oscPort = oscSocket.address().port;
          // Tell the device to send OSC to us
          oscSend('/sys/host', ['s', HOST]);
          oscSend('/sys/port', ['i', oscPort]);
          oscSend('/sys/prefix', ['s', '/monome']);
          connected = true;
          const st = { type: 'status', msg: `connected to device on port ${devicePort}` };
          console.log('[bridge]', st.msg);
          ws.send(JSON.stringify(st));
          break;
        }
        case 'led_set': {
          oscSend('/monome/grid/led/set', ['i', msg.x, 'i', msg.y, 'i', msg.s || msg.level || 15]);
          break;
        }
        case 'led_level_set': {
          oscSend('/monome/grid/led/level/set', ['i', msg.x, 'i', msg.y, 'i', msg.level]);
          break;
        }
        case 'led_all': {
          oscSend('/monome/grid/led/all', ['i', msg.s || 0]);
          break;
        }
        case 'led_map': {
          // msg.data is array of 8 uint8 (one per row), each bit is a column
          const flat = msg.data.flat ? msg.data.flat() : msg.data;
          oscSend('/monome/grid/led/level/map', ['i', 0, 'i', 0, ...flat.map(v => ['i', v])].flat());
          break;
        }
        case 'prefix': {
          oscSend('/sys/prefix', ['s', msg.prefix]);
          break;
        }
      }
    });

    ws.on('close', () => { wsClients.delete(ws); });
  });

  httpServer.listen(WS_PORT, HOST, () => {
    console.log(`[bridge] WebSocket on ws://${HOST}:${WS_PORT}`);
  });
}

// --- Start ---

startOscSocket();
setupWs();

console.log(`[bridge] serialosc supervisor at udp://${HOST}:${SOSC_PORT}`);
console.log('[bridge] waiting for devices...');

// Re-discover every 30s in case devices are unplugged/replugged
setInterval(() => {
  oscSend('/serialosc/list', ['s', HOST, 'i', oscSocket.address().port]);
}, 30000);
