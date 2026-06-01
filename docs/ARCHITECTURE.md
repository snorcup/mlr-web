# Architecture

MLR Web is split into browser-native adapters and a core state machine. Hardware, MIDI, and audio are intentionally separated so future external sync and controller support do not contaminate the MLR logic.

## Components

### `MonomeBridge` (js/monome.js)
WebSocket-to-OSC bridge client. Connects to a local `serialosc-ws-bridge` Node.js process at `ws://localhost:8089`. This is the **primary monome connection path** for older monome classic hardware (8x16, 128, 64, etc.) where key events come over the HID interface (not serial).

- Sends JSON messages to bridge: `discover`, `connect`, LED commands
- Receives key events as `{type: "key", x, y, z}` from bridge
- LED output is throttled to ~30fps to prevent WebSocket flood
- Deferred draw coalescing: only the latest frame is sent during throttle window
- Falls back to `MonomeSerial` if bridge connection fails

### `MonomeSerial` (js/monome.js)
Web Serial API direct connection. Opens the monome as a serial device (FTDI), parses native byte packets. Works with monome hardware that emits key bytes over the serial interface.

- Tries 9600 baud first (older firmware), then 115200
- Parses binary key packets (`0x20`/`0x21`) and system queries
- Sends LED commands: `0x10`-`0x13`, `0x18` for level
- Verbose logging of all serial reads (hex dump per read)

### `AudioEngine` (js/audio-engine.js)
Web Audio API clip and track manager. Owns `AudioContext`, master gain, clip array, and track state.

- Track state: clipIndex, source node, gain node, loop/rate/volume, loopStart/loopEnd
- **loop mode**: tracks default to `loop: true`; clips loop continuously from trigger position
- **custom loop regions**: per-track loopStart/loopEnd override; clip loops within that region
- `loadFiles(files)`: decodes audio files via `decodeAudioData`, pushes to clip array
- `playTrack(trackIndex, slice)`: stops current source, creates new `AudioBufferSourceNode`, starts from slice offset
- `jump(trackIndex, slice)`: alias for `playTrack` (stops and restarts from new position)
- `positionSlice(trackIndex)`: returns current clip position as column 0-15, accounting for loop region
- Tracks are independent: multiple tracks can loop simultaneously

### `MidiManager` (js/midi.js)
Web MIDI adapter. Listens for MIDI clock, start, and stop messages. Normalizes raw MIDI into clock-like events.

- `enable()`: requests `navigator.requestMIDIAccess`, attaches `onmidimessage` handlers
- Handles: MIDI clock (`0xF8` → `onClock`), start (`0xFA` → `onStart`), stop (`0xFC` → `onStop`)
- `clockTicks` counter incremented per clock message (24 PPQN)
- Exposes `onMessage` hook for future controller mapping

### `InternalClock` (js/midi.js)
Internal quantization clock based on `AudioContext.currentTime`.

- BPM-adjustable (20-300), configurable subdivision (default: 4 = 16th notes)
- `shouldTick(now)`: returns true when the next clock boundary is reached
- Used by `MlrCore.tick()` to flush quantized event queue

### `MlrCore` (js/monome.js)
Pure-ish sampler state machine. Contains all grid logic, view modes, loop toggle, and pattern recording.

- **State**: selected view (CUT/REC/TIME), quantize on/off, event queue, track configs, pattern array
- **`handleGridKey(event, now)`**: main entry point for all pad presses
  - Bottom row: view selection (x=0-2), stop all (x=3), pattern play (x=8-11), pattern record (x=12-15)
  - Track rows in CUT/REC mode: tap to loop, tap same pad again to stop (toggle)
  - Track rows in TIME mode: 1st press = loop start, 2nd press = loop end
- **`exec(event)`**: calls `audio.jump(track, slice)` to trigger playback
- **`stopTrack(trackIndex)`**: stops audio source, clears active slice, removes queued events
- **`stopAll()`**: stops all tracks
- **Pattern recording**: `startPatternRecord(slot)` / `stopPatternRecord(slot)` / `togglePatternRecord(slot)`
  - Records `{track, slice, time}` events into pattern slot while recording
  - `recordPatternEvent(event, now)`: appends to all recording patterns
- **Pattern playback**: `startPatternPlayback(slot)` / `stopPatternPlayback(slot)` / `togglePatternPlayback(slot)`
  - `tickPatterns(now)`: emits due events on each tick, loops at recorded length
  - Events sorted by time; supports loop wraparound via cycle/phase tracking
- **`framebuffer()`**: generates 8x16 LED grid array
  - CUT/REC mode: playhead position per track (bright = current slice)
  - TIME mode: loop region per track (bright = start, dim = interior range, single bright = start set, waiting for end)
  - Bottom row: view LEDs, stop indicator, pattern play/record LEDs
- **`render()`**: calls `onRender(framebuffer, state)` → UI + monome LED update

### `UI` (js/ui.js)
DOM adapter and on-screen grid mirror.

- `makeGrid()`: creates 128 pad buttons (8 rows × 16 columns)
- `makeTracks()`: creates 7 track panels with drop zones and file pickers
- `render(frame)`: updates pad CSS classes (`on` l≥12, dim 0<l<12)
- `renderPatterns(patterns)`: updates P1-P4 button states and status text
- `setClipNames(clips)`: updates track labels with loaded clip names
- `onPad(fn)`: attaches pointerdown/up/leave handlers, emits `{x, y, state}` events
- `onDropFiles` / `onFilePick`: callbacks for drag-and-drop and file picker integration

## Data Flow

```
Physical monome (USB)
    ↓ (HID events via libusb)
serialosc daemon (UDP OSC :12002)
    ↓ (UDP OSC messages)
serialosc-ws-bridge (Node.js, ws://localhost:8089)
    ↓ (JSON over WebSocket)
MonomeBridge.connect()
    ↓ {type:"key", x, y, z}
MlrCore.handleGridKey()
    ↓ exec() → audio.jump(track, slice)
AudioEngine.playTrack(track, slice)
    ↓ AudioBufferSourceNode.start()
Web Audio API → speakers

MlrCore.tick(now) ← InternalClock.shouldTick(now)
    ↓ flush quantized queue
    ↓ tickPatterns(now)
MlrCore.render()
    ↓ framebuffer (8×16)
    → UI.render(frame)     → DOM grid mirror update
    → MonomeBridge.draw()  → WebSocket → bridge → OSC → serialosc → monome LEDs
```

## 16 Slices on an 8×16 Classic

Rows 0-6 are tracks. Columns 0-15 map directly to slices 1-16:

```
slice = x  (direct mapping, no modifier needed)
```

Slice offset in seconds: `(slice / 16) * clip.duration`

The bottom row (row 7) is reserved for function controls.

## Grid Toggle Logic (CUT/REC mode)

Each track remembers its last active slice. On pad press:

1. If the track is already playing at that exact slice → **stop** the track (toggle off)
2. If the track is playing at a different slice → **restart** from new slice
3. If the track is stopped → **start** looping from that slice

This gives per-track toggle behavior without needing dedicated stop pads.
