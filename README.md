# MLR Web

A browser-based, MLR-inspired live sample-cutting instrument for a **monome classic** connected directly to the host by USB. It uses a **local serialosc WebSocket bridge** to talk to the grid and **Web Audio API** for sample playback, slicing, looping, and quantized jumps. The architecture includes a **Web MIDI-ready clock/input layer** so external MIDI clock sync and controller mapping can be added without rewriting the sampler core.

## Status

Functional prototype with Dockerized static hosting, serialosc WebSocket bridge support, 7-track sample slicing with 16 direct slice columns on an 8x16 monome, per-track loop regions, CUT/REC/TIME view modes, 4-slot pattern recording/playback, internal quantized clock, and MIDI plumbing scaffold.

## Live URL

**https://mlr.51fifty.io**

## Features

- Monome classic 8x16 USB via local serialosc WebSocket bridge (`ws://localhost:8089`)
- Web Serial direct mode fallback (for devices with compatible firmware)
- 7 playable track rows on an 8x16 grid
- 16 slices per track mapped directly across columns 1-16
- Per-track looping with custom loop regions (start/end)
- Toggle playback: tap a pad to loop, tap same pad again to stop
- CUT / REC / TIME view modes with distinct grid behaviors
- STOP ALL button (bottom row column 4)
- 4 pattern recorder slots (P1-P4) that capture slice gestures and loop them
- Web Audio playback with per-track jump, rate, volume, and position tracking
- Internal quantization clock (synced to `AudioContext.currentTime`), BPM-adjustable
- Web MIDI manager: listens for MIDI clock (`0xF8`), start (`0xFA`), stop (`0xFC`)
- On-screen grid mirror + track drop zones for testing without hardware
- Drag-and-drop or click-to-pick audio file loading per track
- Docker + Compose setup for repeatable deployment
- Cache-busting HTML headers to ensure browsers pick up new assets after deploy

## Grid Layout

```
Columns:  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16
          └──────────── 16 slices per track ──────────────┘

Row 1:    Track 1 slices 1-16  (tap = loop from slice, tap again = stop)
Row 2:    Track 2 slices 1-16
Row 3:    Track 3 slices 1-16
Row 4:    Track 4 slices 1-16
Row 5:    Track 5 slices 1-16
Row 6:    Track 6 slices 1-16
Row 7:    Track 7 slices 1-16
Row 8:    Function/control row (see below)
```

### Bottom Row (Row 8) Button Map

| x=0 | x=1 | x=2 | x=3 | x=4-7 | x=8 | x=9 | x=10 | x=11 | x=12 | x=13 | x=14 | x=15 |
|-----|-----|-----|-----|-------|-----|-----|------|------|------|------|------|------|
| CUT | REC | TIME | STOP ALL | — | P1 play | P2 play | P3 play | P4 play | P1 rec | P2 rec | P3 rec | P4 rec |

## View Modes

### CUT (default)
- Tap a track pad → clip loops from that slice position
- Tap the same pad again → stops that track (toggle off)
- Tap a different pad on same track → restarts from new slice
- Tap a pad on a different track → starts that track independently
- Position LED shows current playhead, cycling across all 16 columns

### REC
- Same trigger behavior as CUT
- Visual indicator (REC LED lit) shows recording mindset
- Use with P1-P4 record buttons (bottom row x=12-15) to capture performances into pattern slots
- Recorded events capture: track row, slice column, relative timestamp

### TIME
- Sets per-track loop region (start and end points)
- 1st press on a track pad → sets loop start (bright LED at that column)
- 2nd press on same track → sets loop end (range lights up, start=bright, middle=dim)
- Playback loops only within the defined region instead of the full clip
- To reset: after setting end, the track is ready; press again to start over
- Grid shows loop region per track: bright = start, dim = region interior

## Pattern Recording

- 4 independent pattern slots: P1, P2, P3, P4
- Start recording a slot: press P1-P4 REC button (bottom row x=12-15)
- While recording, all slice pad hits across all tracks are captured with timestamps
- Stop recording: press the same REC button again
- Pattern length = duration from first to last recorded event (min 0.25s)
- Playback: press P1-P4 play button (bottom row x=8-11)
- Playing patterns loop at their recorded duration
- Pattern playback is independent of live pad triggers
- Multiple patterns can play simultaneously
- Pattern LEDs: bright = recording, medium = playing, dim = has events, off = empty

## Using the App

1. Open in **Chrome or Edge** (Chromium required)
2. Log in via Authentik
3. Click **Start audio** (required by browser autoplay policy)
4. Load audio files: drag-and-drop onto track slots, or click a track to open file picker
5. Use the on-screen grid or physical monome:
   - Tap pads to trigger loops (rows 1-7)
   - Bottom row for functions (views, stop, patterns)
6. Click **Connect monome USB** to connect hardware:
   - Browser connects to local serialosc bridge at `ws://localhost:8089`
   - Falls back to Web Serial direct mode if bridge unavailable
7. Optional: click **Enable MIDI** to initialize Web MIDI support
8. Adjust BPM with the number input (default: 120)
9. Toggle Quantize on/off: when on, pad hits are queued to next clock tick

## Browser Requirements

- **Chrome or Edge** (Chromium-based)
- Web Serial requires a secure context (`https://` or `localhost`)
- Firefox/Safari cannot connect to monome classic (no Web Serial support)
- The monome serialosc bridge runs as a local Node.js process on the user's machine

## Quick Start with Docker (local dev)

```bash
git clone https://github.com/snorcup/mlr-web.git
cd mlr-web
docker compose up --build -d
```

Open: `http://127.0.0.1:8088`

Stop: `docker compose down`

## Local Development (without Docker)

```bash
npm install        # install dev deps (vite)
npm test           # run unit tests (7 tests)
npm run check      # syntax check all JS files
npm run serve      # Vite dev server at http://localhost:5173
npm run build      # build verification
```

## Project Layout

```
.
├── Dockerfile                  # multi-stage: deps → test → nginx runtime
├── docker-compose.yml          # local dev service definition
├── docker/nginx.conf           # nginx config with cache-control headers
├── .dockerignore               # excludes node_modules, .git, coverage
├── index.html                  # app entry point with cache-busting query strings
├── package.json                # project metadata and scripts
├── css/
│   └── style.css               # grid, pads, track panels, drop zones
├── js/
│   ├── app.js                  # bootstrap: wires audio, monome, MIDI, UI, patterns
│   ├── audio-engine.js         # Web Audio: clip loading, track playback, loop regions
│   ├── midi.js                 # MidiManager + InternalClock
│   ├── mlr-core.js             # sampler state machine: views, loop toggle, patterns
│   ├── monome.js               # MonomeBridge (WebSocket→OSC) + MonomeSerial (Web Serial)
│   └── ui.js                   # DOM: grid mirror, track panels, pattern controls
├── scripts/
│   ├── serialosc-bridge.js     # reference serialosc bridge implementation
│   ├── serialosc-ws-bridge.js  # production WS-to-OSC bridge (runs on local machine)
│   ├── serialosc-ws-bridge.service  # systemd unit for the WS bridge
│   ├── serialosc.service       # systemd unit for serialoscd
│   └── build-check.js          # build verification script
├── test/
│   └── mlr-core.test.js        # 7 unit tests
├── docs/
│   ├── ARCHITECTURE.md         # system architecture and data flow
│   ├── MONOME.md               # monome hardware protocol and bridge details
│   └── DEPLOYMENT.md           # production deployment and update procedures
└── README.md                   # this file
```

## Validation

```bash
npm test          # 7 unit tests (grid mapping, quantize, parser, patterns)
npm run check     # syntax check all JS files
npm run build     # build verification
```

Container verification:

```bash
docker compose up --build -d
curl -fsS http://127.0.0.1:8088/ | grep 'MLR Web'
docker inspect --format='{{json .State.Health}}' mlr-web
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full production deployment details.

Quick update on panel:
```bash
cd /opt/mlr-web
git pull --ff-only
docker compose up --build -d
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system architecture, component descriptions, and data flow.

## Monome Hardware

See [docs/MONOME.md](docs/MONOME.md) for monome classic USB protocol, serialosc bridge setup, and troubleshooting.

## Roadmap

- [ ] External MIDI clock as selectable master clock source
- [ ] MIDI learn for controller mappings (CC → volume, mute, track select)
- [ ] Mute groups
- [ ] Reverse playback per track
- [ ] Multiple clip slots per track (switch which clip a track plays)
- [ ] Live input capture via `getUserMedia` + `AudioWorklet`
- [ ] Persistent project/session save and load
- [ ] Per-track volume and rate UI controls
- [ ] HTTPS dev container profile for testing Web Serial from non-localhost clients

## License

MIT
