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

- Track state: clipIndex, source node, gain node, loop/rate/volume, loopStart/loopEnd, muted, mode (CUT/SOLO/MUTE/ONCE)
- **CUT mode** (default): tracks loop continuously from trigger position
- **ONCE mode**: `source.loop = false`; clip plays through once from trigger position
- **SOLO mode**: mutes all other tracks; track itself is unmuted
- **MUTE mode**: track gain set to 0; independent of playback state
- **Custom loop regions**: per-track loopStart/loopEnd override; clip loops within that region
- `loadFiles(files)`: decodes audio files via `decodeAudioData`, pushes to clip array
- `playTrack(trackIndex, slice)`: stops current source, creates new `AudioBufferSourceNode`, starts from slice offset. If already playing at same slice, toggles off.
- `jump(trackIndex, slice)`: if not playing, starts from slice; if playing, repositions
- `stopTrack(trackIndex)`: stops audio source, marks track not playing
- `stopAll()`: stops all tracks
- `setMode(trackIndex, mode)`: sets per-track mode, handles SOLO/MUTE gain changes
- `positionSlice(trackIndex)`: returns current clip position as column 0-15
- Tracks are independent: multiple tracks can play simultaneously

### `MidiManager` (js/midi.js)
Web MIDI adapter. Listens for MIDI clock, start, and stop messages.

- `enable()`: requests `navigator.requestMIDIAccess`, attaches `onmidimessage` handlers
- Handles: MIDI clock (`0xF8` → `onClock`), start (`0xFA` → `onStart`), stop (`0xFC` → `onStop`)
- `clockTicks` counter incremented per clock message (24 PPQN)

### `InternalClock` (js/midi.js)
Internal quantization clock based on `AudioContext.currentTime`.

- BPM-adjustable (20-300), configurable subdivision (default: 4 = 16th notes)
- `shouldTick(now)`: returns true when the next clock boundary is reached
- Used by `MlrCore.tick()` to flush quantized event queue

### `MlrCore` (js/mlr-core.js)
Pure-ish sampler state machine. Contains all grid logic, view modes, per-track modes, loop toggle, and pattern recording.

- **State**: selected view (CUT/REC/TIME), quantize on/off, event queue, track configs, pattern array
- **Per-track modes**: each track is one of `CUT`, `SOLO`, `MUTE`, `ONCE`
  - `CUT` (default): normal toggle — tap to loop, tap same pad to stop
  - `SOLO`: mutes all other tracks; track itself is unmuted
  - `MUTE`: track is silenced
  - `ONCE`: one-shot playback; clip plays through once without looping. Multiple tracks can play simultaneously.
- **Pending mode** (`pendingMode`): when a mode button is pressed, this holds the mode to apply. Next track row press applies the mode. Press the same mode button again to cancel.
- **`handleGridKey(event, now)`**: main entry point for all pad presses
  - Row 0 (nav): view select (x=0-2), patterns (x=4-7), recalls (x=8-11), quantize (x=14), alt (x=15)
  - Rows 1-6 (tracks): behavior depends on view mode and per-track mode
  - Row 7 (function): mode buttons (x=0-3), pattern toggle (x=4-7)
- **`setTrackMode(trackIndex, mode)`**: applies a mode to a track, updates AudioEngine state
- **`stopAll()`**: stops all tracks
- **Pattern recording**: 4 slots. Records `{track, slice, time}` events while recording.
- **Pattern playback**: loops at recorded duration. Events sorted by time; supports loop wraparound.
- **Recall recording**: 4 slots. Captures all events in real-time for instant playback.
- **`framebuffer()`**: generates 8x16 LED grid array
  - Row 0: view LEDs (bright=active), pattern/recall LEDs, quantize/alt
  - Rows 1-6: playhead position per track (bright = current slice), loop region (dim)
  - Row 7: mode button LEDs (lit when pending/active), pattern LEDs (off/dim/medium/bright)
- **`render()`**: calls `onRender(framebuffer, state)` → UI + monome LED update

### `UI` (js/ui.js)
DOM adapter and on-screen grid mirror.

- `makeGrid()`: creates 128 pad buttons (8 rows × 16 columns)
- `makeTracks()`: creates 6 track panels with drop zones, file pickers, and per-track mode labels
- `render(frame)`: updates pad CSS classes (`on` if l≥12, `dim` if 0<l<12)
- `renderPatterns(patterns)`: updates pattern button states and status text
- `setClipNames(clips)`: updates track labels with loaded clip names
- `onPad(fn)`: attaches pointerdown/up/leave handlers, emits `{x, y, state}` events
- `onDropFiles` / `onFilePick`: callbacks for drag-and-drop and file picker integration
- `updateTrackModes(tracks)`: updates per-track mode badges (C/S/M/1)
- `updatePendingMode(pending)`: shows pending mode indicator

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
    ├─ row 0 → view/mode/pattern/recall dispatch
    ├─ rows 1-6 → CUT/REC/TIME view behavior per track
    │   ├─ CUT: toggle loop/stop (same slice), jump (different slice)
    │   ├─ ONCE: always start new one-shot
    │   └─ SOLO/MUTE: handled by AudioEngine
    └─ row 7 → mode buttons, pattern toggle
        ├─ mode button press → set pendingMode
        └─ if pendingMode set + track row pressed → setTrackMode(track, mode)
    ├─ exec → audio.jump(track, slice)
    └─ AudioEngine.playTrack(track, slice)
         ↓ AudioBufferSourceNode.start()
Web Audio API → speakers

MlrCore.tick(now) ← InternalClock.shouldTick(now)
    ↓ flush quantized queue
    ↓ tickPatterns(now)
MlrCore.render()
    ↓ framebuffer (8×16)
    → UI.render(frame)     → DOM grid mirror update
    → UI.updateTrackModes() → track panel badges
    → monome draw        → WebSocket → bridge → OSC → serialosc → monome LEDs
```

## 16 Slices on an 8x16 Classic

Rows 1-6 are tracks. Columns 0-15 map directly to 16 equal divisions of the loaded clip.

```
slice = x  (direct mapping, 0-15)
```

Slice offset in seconds: `(slice / 16) * clip.duration`

Row 0 is the nav/control row. Row 7 is the function row (modes + patterns).

## Grid Toggle Logic

Each track remembers its last active slice. On pad press in CUT view:

1. If the track's mode is `MUTE` → press is ignored (track is silenced)
2. If the track's mode is `ONCE` → always starts a new one-shot from pressed slice (no toggle-stop). Previous tracks continue playing.
3. If the track's mode is `SOLO` → AudioEngine mutes all other tracks, then proceeds as CUT
4. CUT mode (default):
   - If the track is already playing at that exact slice → **stop** the track (toggle off)
   - If the track is playing at a different slice → **restart** from new slice
   - If the track is stopped → **start** looping from that slice

## Per-Track Mode Assignment

Two-step interaction for assigning modes to tracks:

1. Press mode button (bottom row, x=0=CUT, x=1=SOLO, x=2=MUTE, x=3=ONCE) → button lights up, `pendingMode` is set
2. Press a track row (y=1-6) → `setTrackMode(track, mode)` is called, `pendingMode` is cleared
3. Press the same mode button again → cancels pending mode without applying

This allows quick mode assignment to multiple tracks: press SOLO, tap tracks 1, 3, 5 — now only those three tracks are audible.
