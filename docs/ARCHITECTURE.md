# Architecture

MLR Web is split into browser-native adapters and a small core state machine. Hardware, MIDI, and audio are intentionally separated so future external sync and controller support do not contaminate the MLR logic.

## Components

- `MonomeSerial`: Web Serial adapter for monome classic byte packets. Emits normalized `{x, y, state}` key events and accepts an 8×16 LED framebuffer.
- `AudioEngine`: Web Audio clip and track manager. Handles buffer loading, track jumps, rate, volume, and position slices.
- `MidiManager`: Web MIDI adapter. Currently normalizes MIDI clock/start/stop. Future controller messages should be mapped here before entering `MlrCore`.
- `MlrCore`: Pure-ish sampler logic: grid key handling, direct 16-slice grid mapping, quantized queueing, four-slot pattern recording/playback, and LED framebuffer generation.
- `UI`: DOM adapter and on-screen grid mirror.

## Data Flow

```text
Physical monome / browser grid
        ↓ key events
      MlrCore ← MIDI clock / internal clock
        ↓ jump/render decisions
AudioEngine       LED framebuffer
        ↓              ↓
Web Audio       MonomeSerial + UI mirror
```

## 16 slices on an 8×16 classic

Rows 0–6 are tracks. Columns 0–15 represent the complete slice range directly:

- `slice = x`

The bottom row is reserved for function controls. Columns 0–2 select CUT/REC/TIME.

## Pattern recording

`MlrCore` owns four pattern slots. A pattern stores normalized `{time, track, slice}` events where `time` is seconds since recording started.

- Start recording P1–P4 from the browser controls or bottom-row columns 12–15.
- Press slice pads; each hit is appended to every actively recording pattern.
- Stop recording to set the loop length to the record duration.
- Start playback from the browser controls or bottom-row columns 8–11.
- During `tick(now)`, each playing pattern emits due events and wraps at its recorded length.

Pattern playback currently replays slice jumps directly into `AudioEngine`. Quantized live hits can still be enabled separately; pattern events preserve the recorded timing.

## Future MIDI Support

Do not add MIDI-specific state directly into `MlrCore` unless it is a normalized musical concept (clock tick, start, stop, control change mapped to a command). Keep browser API details in `MidiManager`.

Recommended next steps:

1. Add a clock source selector: `internal` vs `midi`.
2. Convert 24 PPQN MIDI clock ticks into MLR quantization boundaries.
3. Add MIDI learn mappings in a config object: `{channel, cc, action}`.
4. Feed normalized actions into `MlrCore` (`setVolume`, `toggleMute`, `setModifier`, etc.).
