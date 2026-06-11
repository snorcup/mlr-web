# MLR Web

A browser-based, MLR-inspired live sample-cutting instrument for a **monome classic** connected directly to the host by USB. It uses a **local serialosc WebSocket bridge** to talk to the grid and **Web Audio API** for sample playback, slicing, looping, and quantized jumps. The architecture includes a **Web MIDI-ready clock/input layer** so external MIDI clock sync and controller mapping can be added without rewriting the sampler core.

## Status

Functional prototype with Dockerized static hosting, serialosc WebSocket bridge support, 6-track sample slicing with 16 direct slice columns on an 8x16 grid, per-track loop regions, per-track modes (CUT/SOLO/MUTE/ONCE), CUT/REC/TIME view modes, 4-slot pattern recording/playback, internal quantized clock, and MIDI plumbing scaffold.

## Live URL

**https://mlr.51fifty.io**

## Features

- Monome classic 8x16 USB via local serialosc WebSocket bridge (`ws://localhost:8089`)
- Web Serial direct mode fallback (for devices with compatible firmware)
- 6 playable track rows on an 8x16 grid
- 16 slices per track mapped directly across columns 0-15
- Per-track looping with custom loop regions (start/end)
- Per-track modes: CUT (toggle loop/stop), SOLO (mute others), MUTE (silence track), ONCE (one-shot, no loop)
- CUT / REC / TIME view modes with distinct grid behaviors
- 4 pattern recorder slots (P1-P4) — one button each, toggle record/play
- 4 recall slots (R1-R4) — record and replay parameter snapshots
- STOP ALL — immediately kills all playing tracks
- Web Audio playback with per-track jump, rate, volume, and position tracking
- Internal quantization clock (synced to `AudioContext.currentTime`), BPM-adjustable
- Web MIDI manager: listens for MIDI clock (`0xF8`), start (`0xFA`), stop (`0xFC`)
- On-screen grid mirror + track drop zones for testing without hardware
- Drag-and-drop or click-to-pick audio file loading per track
- Docker + Compose setup for repeatable deployment
- Cache-busting HTML headers to ensure browsers pick up new assets after deploy

## Grid Layout

```
Columns:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
          └──────────── 16 slices per track ──────────────┘

Row 0:    Nav row (views, patterns, recalls, quantize, alt)
Row 1:    Track 1 slices 0-15  (tap = loop, tap same = stop)
Row 2:    Track 2 slices 0-15
Row 3:    Track 3 slices 0-15
Row 4:    Track 4 slices 0-15
Row 5:    Track 5 slices 0-15
Row 6:    Track 6 slices 0-15
Row 7:    Function row (modes, patterns)
```

### Row 0 (Nav)

| x=0 | x=1 | x=2 | x=3 | x=4-7 | x=8-11 | x=12-13 | x=14 | x=15 |
|-----|-----|-----|-----|--------|---------|----------|------|------|
| REC | CUT | CLIP | dark | P1-P4 | R1-R4 | dark | Quant | Alt |

- **x=0-2**: View buttons (REC, CUT, CLIP). Bright = active view. Dark = inactive.
- **x=4-7**: Pattern triggers. Off = empty, dim = has data, medium = playing, bright = recording. Alt+press to clear.
- **x=8-11**: Recall slots. Off = empty, dim = has data, medium = playing, bright = recording.
- **x=14**: Quantize toggle. Off = immediate, lit = quantized to clock.
- **x=15**: Alt modifier (held).

### Row 7 (Function)

| x=0 | x=1 | x=2 | x=3 | x=4 | x=5 | x=6 | x=7 | x=8-15 |
|-----|-----|-----|-----|-----|-----|-----|-----|--------|
| CUT | SOLO | MUTE | ONCE | P1 | P2 | P3 | P4 | dark |

- **x=0-3**: Track mode selectors. Press a mode, then press a track row (y=1-6) to apply. Press same mode again to cancel pending.
- **x-4-7**: Pattern toggle. Empty → record, recording → stop+play, playing → stop, has data → play.

## View Modes

### CUT (default)
- Tap a track pad → clip loops from that slice position
- Tap the same pad again → stops that track (toggle off)
- Tap a different pad on same track → restarts from new slice
- Tap a pad on a different track → starts that track independently
- Position LED shows current playhead, cycling across all 16 columns
- Two-finger press → set loop region on release
- ONCE mode: each tap starts a new one-shot; previous tracks continue playing

### REC
- Same trigger behavior as CUT
- Per-track controls: record arm (x=0), reverse (x=7), speed (x=8-14, x=11=1x), start/stop (x=15)
- Focus select (x=2,3)
- Use with P1-P4 pattern buttons to capture performances into pattern slots

### TIME
- Sets per-track loop region (start and end points)
- 1st press on a track pad → sets loop start (bright LED)
- 2nd press on same track → sets loop end (range lights up)
- Playback loops only within the defined region

## Per-Track Modes

Each track can be independently assigned a mode. Press a mode button (bottom row x=0-3), then press any track row (y=1-6) to apply. The mode button lights up to indicate a pending assignment. Press the same mode button again to cancel.

| Mode | Button | Behavior |
|------|--------|----------|
| **CUT** (default) | x=0 | Normal toggle: tap slice to loop, tap same pad to stop. |
| **SOLO** | x=1 | Mutes all other tracks so only this track plays. |
| **MUTE** | x=2 | Silences the track. |
| **ONCE** | x=3 | One-shot playback: clip plays through once without looping. Multiple tracks can play simultaneously. |

Track mode indicators appear in the track panels:
- `C` (green) = CUT
- `S` (purple) = SOLO
- `M` (red) = MUTE
- `1` (yellow) = ONCE

## Patterns

- 4 independent pattern slots: P1, P2, P3, P4
- **Bottom row (x=4-7)**: One button per pattern. Press to toggle:
  - Empty → start recording
  - Recording → stop recording, start playback
  - Playing → stop playback
  - Has data, not playing → start playback
- **Nav row (x=4-7)**: Same pattern triggers (mirrors bottom row for monome compatibility)
- **Alt + press** (nav row): Clear pattern
- While recording, all slice pad hits across all tracks are captured with timestamps
- Pattern playback loops at recorded duration
- Multiple patterns can play simultaneously
- Pattern LEDs: bright = recording, medium = playing, dim = has data, off = empty

## Recalls

- 4 recall slots: R1, R2, R3, R4 (nav row x=8-11)
- 1st press → start recording all subsequent events
- 2nd press → stop recording
- 3rd press → replay (fire) the recorded events
- Alt + press → clear

## Using the App

1. Open in **Chrome or Edge** (Chromium required)
2. Log in via Authentik
3. Click **Start audio** (required by browser autoplay policy)
4. Load audio files: drag-and-drop onto track slots, or click a track to open file picker
5. Use the on-screen grid or physical monome:
   - Tap pads to trigger loops (rows 1-6)
   - Row 0 for views, patterns, recalls
   - Row 7 for track modes and pattern toggle
6. Click **Connect monome USB** to connect hardware:
   - Browser connects to local serialosc bridge at `ws://localhost:8089`
   - Falls back to Web Serial direct mode if bridge unavailable
7. Optional: click **Enable MIDI** to initialize Web MIDI support
8. Adjust BPM with the number input (default: 120)
9. Toggle Quantize on/off (nav x=14): when on, pad hits are queued to next clock tick

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
npm test           # run unit tests (44 tests)
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
│   ├── audio-engine.js         # Web Audio: clip loading, track playback, loop regions, per-track modes
│   ├── midi.js                 # MidiManager + InternalClock
│   ├── mlr-core.js             # sampler state machine: views, track modes, loop toggle, patterns
│   ├── monome.js               # MonomeBridge (WebSocket→OSC) + MonomeSerial (Web Serial)
│   └── ui.js                   # DOM: grid mirror, track panels, pattern/track-mode controls
├── scripts/
│   ├── serialosc-bridge.js     # reference serialosc bridge implementation
│   ├── serialosc-ws-bridge.js  # production WS-to-OSC bridge (runs on local machine)
│   ├── serialosc-ws-bridge.service  # systemd unit for the WS bridge
│   ├── serialosc.service       # systemd unit for serialoscd
│   └── build-check.js          # build verification script
├── test/
│   └── mlr-core.test.js        # 44 unit tests
├── docs/
│   ├── ARCHITECTURE.md         # system architecture and data flow
│   ├── MONOME.md               # monome hardware protocol and bridge details
│   └── DEPLOYMENT.md           # production deployment and update procedures
└── README.md                   # this file
```

## Validation

```bash
npm test          # 44 unit tests (grid mapping, quantize, parser, patterns, modes)
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

- [x] Per-track modes (CUT/SOLO/MUTE/ONCE)
- [x] 6 tracks (faithful to OG MLR)
- [x] Pattern recording/playback
- [x] Recall slots
- [x] STOP ALL
- [ ] External MIDI clock as selectable master clock source
- [ ] MIDI learn for controller mappings (CC → volume, mute, track select)
- [ ] Mute groups
- [ ] Multiple clip slots per track (switch which clip a track plays)
- [ ] Live input capture via `getUserMedia` + `AudioWorklet`
- [ ] Persistent project/session save and load
- [ ] Per-track volume and rate UI controls
- [ ] HTTPS dev container profile for testing Web Serial from non-localhost clients

## License

MIT
