# MLR Web

A browser-based, MLR-inspired live sample-cutting instrument for a **monome classic** connected directly to the host by USB. It uses the browser's **Web Serial API** to talk to the grid and **Web Audio API** for sample playback, slicing, looping, and quantized jumps. The architecture includes a **Web MIDI-ready clock/input layer** so external MIDI clock sync and controller mapping can be added without rewriting the sampler core.

## Status

Initial implementation: usable browser prototype with Dockerized static hosting, monome classic serial driver, 7-track sample slicing, 16 slices per track using a modifier page, internal quantized clock, and MIDI plumbing scaffold.

## Features

- Direct monome classic USB support via Web Serial.
- Native serial protocol support for key input and LED output.
- 7 playable track rows on an 8×8 grid.
- 16 slices per track:
  - default page: slices 1–8
  - modifier held: slices 9–16
- Web Audio playback with per-track jump, rate, volume, and loop-ready model.
- Internal quantization clock based on `AudioContext.currentTime`.
- Web MIDI manager that already handles MIDI clock (`0xF8`), start (`0xFA`), and stop (`0xFC`).
- On-screen grid mirror for testing without hardware.
- Docker + Compose setup for repeatable local hosting.

## Browser Requirements

Use Chrome, Edge, or another Chromium browser.

- Web Serial requires Chromium and a secure context (`https://` or `localhost`).
- Web MIDI support varies by browser and OS.
- Firefox/Safari currently cannot connect to monome classic over Web Serial.

## Quick Start with Docker

```bash
docker compose up --build -d
```

Open:

```text
http://127.0.0.1:8088
```

Stop:

```bash
docker compose down
```

## Local Development

```bash
npm install
npm test
npm run serve
```

Then open the Vite URL, usually `http://localhost:5173`.

## Using the App

1. Click **Start audio**.
2. Load one or more audio files with the file picker.
3. Use the on-screen grid or physical monome:
   - rows 1–7 trigger tracks
   - columns 1–8 trigger slices 1–8
   - hold the modifier to trigger slices 9–16
   - bottom row contains view/function controls
4. Click **Connect monome USB** and choose the FTDI/monome device from the browser picker.
5. Optional: click **Enable MIDI** to initialize Web MIDI support. The current implementation listens for MIDI clock/start/stop and exposes the path for future sync work.

## Hardware Notes

The monome classic speaks a compact byte protocol over FTDI USB serial. This implementation intentionally bypasses serialosc so the app remains browser-only.

Important bytes:

- `0x10 x y`: LED off
- `0x11 x y`: LED on
- `0x12`: all LEDs off
- `0x13`: all LEDs on
- `0x18 x y level`: LED level
- `0x20 x y`: key up
- `0x21 x y`: key down

## MIDI Architecture

MIDI is intentionally isolated in `js/midi.js`. The sampler core depends on clock-like events, not directly on browser MIDI APIs. This keeps future work straightforward:

- external MIDI clock sync
- MIDI transport start/stop
- controller mappings for volume, mute, track focus, and pattern record
- MIDI file or network clock sources

The intended extension point is `MidiManager.handleMessage()`, which emits normalized events into `MlrCore`.

## Project Layout

```text
.
├── Dockerfile
├── docker-compose.yml
├── docker/nginx.conf
├── index.html
├── css/style.css
├── js/
│   ├── app.js              # browser bootstrap
│   ├── audio-engine.js     # Web Audio clip playback
│   ├── event-bus.js        # tiny event helper
│   ├── midi.js             # Web MIDI-ready clock/input layer
│   ├── mlr-core.js         # sampler state machine and grid rendering
│   ├── monome.js           # Web Serial monome classic driver
│   └── ui.js               # DOM/grid mirror
├── scripts/build-check.js
└── test/mlr-core.test.js
```

## Validation

Run unit checks:

```bash
npm test
npm run check
npm run build
```

Run container verification:

```bash
docker compose up --build -d
curl -fsS http://127.0.0.1:8088/
docker inspect --format='{{json .State.Health}}' mlr-web
```

## Roadmap

- Better track controls: mute groups, reverse playback, record arming.
- Pattern recording with four independent pattern slots.
- Live input capture via `getUserMedia` + `AudioWorklet` or `MediaRecorder`.
- External MIDI clock as selectable master clock.
- MIDI learn for controller mappings.
- Persistent project/session files.
- Optional HTTPS dev container profile for testing Web Serial from non-localhost clients.

## License

MIT
