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

- Track state: clipIndex, source node, gain node, loop/rate/volume, loopStart/loopEnd, muted, once
- **loop mode**: tracks default to `loop: true`; clips loop continuously from trigger position
- **custom loop regions**: per-track loopStart/loopEnd override; clip loops within that region
- **one-shot mode** (`track.once`): when set, `source.loop = false`; clip plays through once from trigger position
- **per-track mute** (`track.muted`): when set, gain is set to 0; independent of playback state
- `loadFiles(files)`: decodes audio files via `decodeAudioData`, pushes to clip array
- `playTrack(trackIndex, slice)`: stops current source, creates new `AudioBufferSourceNode`, starts from slice offset. Honors `loop`, `once`, `loopStart`/`loopEnd`, `muted`, and `volume` per track.
- `jump(trackIndex, slice)`: alias for `playTrack` (stops and restarts from new position)
- `stopTrack(trackIndex)`: stops audio source, marks track not playing
- `setVolume(trackIndex, value)`: set per-track volume (0-1), ignored if track is muted
- `setRate(trackIndex, value)`: set per-track playback rate
- `setMuted(trackIndex, muted)` / `toggleMute(trackIndex)`: per-track mute control
- `setOnce(trackIndex, once)`: enable/disable one-shot mode per track
- `positionSlice(trackIndex)`: returns current clip position as column 0-15; accounts for loop region and one-shot playback
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

### `MlrCore` (js/mlr-core.js)
Pure-ish sampler state machine. Contains all grid logic, view modes, per-track modes, loop toggle, and pattern recording.

- **State**: selected view (CUT/REC/TIME), quantize on/off, event queue, track configs, pattern array
- **Per-track modes** (`_trackModes[_]`): each track is one of `CUT`, `SOLO`, `MUTE`, `ONCE`
  - `CUT` (default): normal toggle — tap to loop, tap same pad to stop
  - `SOLO`: mutes all other tracks; track itself is unmuted
  - `MUTE`: track is silenced; slice presses ignored
  - `ONCE`: one-shot playback; clip plays through once without looping
- **Pending mode** (`_pendingMode`): when a mode button is pressed, this holds the mode to apply. Next track row press applies the mode. Press the same mode button again to cancel.
- **`handleGridKey(event, now)`**: main entry point for all pad presses
  - Bottom row:
    - x=0-2: view selection (CUT/REC/TIME)
    - x=3: stop all
    - x=4-7: per-track mode selectors (CUT/SOLO/MUTE/ONCE). If a mode is pending, it's applied to the pressed track row.
    - x=8-11: pattern play (P1-P4)
    - x=12-15: pattern record (P1-P4)
  - Track rows: behavior depends on the track's assigned mode (see Per-Track Modes section below)
- **`applyTrackMode(trackIndex, mode)`**: applies a mode to a track, updates AudioEngine state (mute/once), and renders
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
  - Bottom row: view LEDs, stop indicator, mode button LEDs (lit when pending), pattern play/record LEDs
- **`render()`**: calls `onRender(framebuffer, state)` → UI + monome LED update

### `UI` (js/ui.js)
DOM adapter and on-screen grid mirror.

- `makeGrid()`: creates 128 pad buttons (8 rows × 16 columns)
- `makeTracks()`: creates 7 track panels with drop zones, file pickers, and per-track mode labels
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
    ├─ bottom row → view/mode/pattern dispatch
    │   ├─ mode button press → set _pendingMode
    │   └─ if _pendingMode set + track row pressed → applyTrackMode(track, mode)
    ├─ exec() → audio.jump(track, slice)
    │                                    ↑ respects track.once, track.muted
    └─ AudioEngine.playTrack(track, slice)
         ↓ AudioBufferSourceNode.start()
Web Audio API → speakers

MlrCore.tick(now) ← InternalClock.shouldTick(now)
    ↓ flush quantized queue
    ↓ tickPatterns(now)
MlrCore.render()
    ↓ framebuffer (8×16)
    → UI.render(frame)     → DOM grid mirror update
    → updateFnReference()  → mode button LEDs, hint text
    → AudioEngine draw  → WebSocket → bridge → OSC → serialosc → monome LEDs
```

## 16 Slices on an 8x16 Classic

Rows 0-6 are tracks. Columns 0-15 map directly to slices 1-16:

```
slice = x  (direct mapping, no modifier needed)
```

Slice offset in seconds: `(slice / 16) * clip.duration`

The bottom row (row 7) is reserved for function controls.

## Grid Toggle Logic (CUT/REC mode, default per-track mode)

Each track remembers its last active slice. On pad press:

1. If the track's per-track mode is `MUTE` → ignores slice presses
2. If the track's per-track mode is `ONCE` → always restarts from pressed slice (no toggle-stop; one-shot each time)
3. If the track's per-track mode is `SOLO` → mutes all other tracks, then proceeds as CUT
4. CUT mode (default):
   - If the track is already playing at that exact slice → **stop** the track (toggle off)
   - If the track is playing at a different slice → **restart** from new slice
   - If the track is stopped → **start** looping from that slice

## Per-Track Mode Assignment

The two-step interaction for assigning modes to tracks:

1. Press mode button (bottom row, x=4,5,6,7) → button lights up, `_pendingMode` is set
2. Press a track row (y=0-6) → `applyTrackMode(track, mode)` is called, `_pendingMode` is cleared
3. Press the same mode button again → cancels pending mode without applying

This allows quick mode assignment to multiple tracks without navigating menus: press SOLO, tap tracks 1, 3, 5 — now only those three tracks are audible.
