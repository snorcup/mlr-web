#!/usr/bin/env node
/**
 * serialosc-bridge.js
 *
 * Small WebSocket-to-OSC bridge for monome grids.
 *
 * Prerequisites:
 *   1. serialosc must be installed and running on this machine.
 *      See https://monome.org/docs/serialosc/setup
 *      On Debian/Ubuntu, build from https://github.com/monome/serialosc
 *   2. A monome device must be plugged in.
 *
 * Usage:
 *   node serialosc-bridge.js
 *
 *   Then open mlr.51fifty.io — the web app will connect via WebSocket
 *   to this bridge and send/receive OSC messages.
 *
 * Protocol (WebSocket text frames, JSON):
 *   Client -> Server:
 *     {"type":"sys/list"}                          — list connected devices
 *     {"type":"connect", "port": 17675}            — connect to device on port
 *     {"type":"set_port", "port": 6666}            — set our listening port
 *     {"type":"cmd", "path":"/monome/grid/led/all", "args":[0]}
 *     {"type":"cmd", "path":"/monome/grid/led/level/set", "args":[x,y,level]}
 *     {"type":"cmd", "path":"/sys/prefix", "args":["/monome"]}
 *
 *   Server -> Client:
 *     {"type":"device", "id":"m128-386", "name":"monome 128", "port":17675}
 *     {"type":"key", "x":9, "y":3, "z":1}
 *     {"type":"status", "msg":"connected to m128-386 on port 17675"}
 */
import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const WS_PORT = 8089;
const SERIALOSC_DISCOVERY_PORT = 12002;

// --- OSC helpers ---
function oscArgs(buf, offset) {
  const args = [];
  // skip to type tag string
  while (offset < buf.length && buf[offset] !== 0x2c) offset++; // find ','
  if (offset >= buf.length) return args;
  offset++; // skip ','
  let typeEnd = buf.indexOf(0, offset);
  const types = buf.slice(offset, typeEnd).toString('ascii');
  let pos = (typeEnd + 4) - ((typeEnd) % 4); // align to 4 bytes
  for (const t of types) {
    if (t === 'i') {
      args.push(buf.readInt32BE(pos));
      pos += 4;
    } else if (t === 's') {
      let end = buf.indexOf(0, pos);
      args.push(buf.slice(pos, end).toString('ascii'));
      pos = (end + 4) - (end % 4);
    } else if (t === 'f') {
      args.push(buf.readFloatBE(pos));
      pos += 4;
    }
  }
  return args;
}

function oscAddress(buf) {
  let end = buf.indexOf(0);
  return buf.slice(0, end).toString('ascii');
}

function encodeOsc(path, args = []) {
  const parts = [path];
  let typeTag = ',';
  const argParts = [];
  for (const a of args) {
    if (typeof a === 'number' && Number.isInteger(a)) {
      typeTag += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a);
      argParts.push(b);
    } else if (typeof a === 'number') {
      typeTag += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      argParts.push(b);
    } else {
      typeTag += 's';
      const s = Buffer.from(String(a));
      argParts.push(s);
    }
  }
  parts.push(typeTag);
  const pathBuf = Buffer.alloc((path.length + 4) - (path.length % 4));
  pathBuf.write(path);
  const typeBuf = Buffer.alloc((typeTag.length + 4) - (typeTag.length % 4));
  typeBuf.write(typeTag);
  return Buffer.concat([pathBuf, typeBuf, ...argParts]);
}

// --- Device discovery ---
let knownDevices = [];
let oscSocket = null;
let deviceSocket = null;
let connectedDevicePort = null;

function startOscListener(wsPort) {
  oscSocket = dgram.createSocket('udp4');
  oscSocket.bind(wsPort, '127.0.0.1', () => {
    console.log(`[bridge] OSC listener on UDP ${wsPort}`);
  });
  oscSocket.on('message', (msg) => {
    const addr = oscAddress(msg);
    const args = oscArgs(msg, addr.length);
    // console.log(`[bridge] OSC ${addr}`, args);
    if (addr.endsWith('/grid/key')) {
      wsClients.forEach(c => c.send(JSON.stringify({ type: 'key', x: args[0], y: args[1], z: args[2] })));
    } else if (addr.endsWith('/device')) {
      const dev = { id: args[0], name: args[1], port: args[2] };
      knownDevices = knownDevices.filter(d => d.id !== dev.id);
      knownDevices.push(dev);
      console.log(`[bridge] device: ${dev.id} ${dev.name} port ${dev.port}`);
      wsClients.forEach(c => c.send(JSON.stringify({ type: 'device', ...dev })));
    }
  });
}

function discoverDevices() {
  const sock = dgram.createSocket('udp4');
  const msg = encodeOsc('/serialosc/list', ['s', '127.0.0.1', 'i', oscSocket?.address()?.port || 7777]);
  sock.send(msg, SERIALOSC_DISCOVERY_PORT, '127.0.0.1');
  sock.on('message', (buf) => {
    setTimeout(() => sock.close(), 100);
  });
  // Also listen for device announcements
  sock.on('message', () => {}); // noop, main socket handles it
}

function sendToDevice(path, args = []) {
  if (!connectedDevicePort) return;
  const msg = encodeOsc(path, args);
  oscSocket.send(msg, connectedDevicePort, '127.0.0.1');
}

// --- WebSocket ---
const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('serialosc bridge ok\n');
});
const wss = new WebSocketServer({ server: httpServer });
let wsClients = new Set();

wss.on('connection', (ws) => {
  console.log('[bridge] WS client connected');
  wsClients.add(ws);

  // Send current device list
  knownDevices.forEach(d => ws.send(JSON.stringify({ type: 'device', ...d })));
  ws.send(JSON.stringify({ type: 'status', msg: `bridge ready, ${knownDevices.length} device(s)` }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch(e) { return; }
    switch (msg.type) {
      case 'sys/list':
        discoverDevices();
        break;
      case 'set_port':
        connectedDevicePort = msg.port;
        sendToDevice('/sys/port', ['i', oscSocket?.address()?.port || 7777]);
        ws.send(JSON.stringify({ type: 'status', msg: `set device port to ${msg.port}` }));
        break;
      case 'connect':
        connectedDevicePort = msg.port;
        sendToDevice('/sys/port', ['i', oscSocket?.address()?.port || 7777]);
        ws.send(JSON.stringify({ type: 'status', msg: `connected to device on port ${msg.port}` }));
        break;
      case 'cmd':
        sendToDevice(msg.path, msg.args || []);
        break;
      default:
        console.log('[bridge] unknown msg:', msg);
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('[bridge] WS client disconnected');
  });
});

// --- Start ---
const OSC_PORT_ARG = parseInt(process.argv[2]) || 7777;
startOscListener(OSC_PORT_ARG);

setTimeout(() => {
  console.log('[bridge] discovering devices...');
  discoverDevices();
}, 1000);

// Re-discover every 5 seconds
setInterval(discoverDevices, 5000);

httpServer.listen(WS_PORT, '127.0.0.1', () => {
  console.log(`[bridge] WebSocket server on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[bridge] OSC listener on udp://127.0.0.1:${OSC_PORT_ARG}`);
  console.log('[bridge] waiting for devices...');
});
