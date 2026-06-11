// app.js — browser bootstrap for web-mlr
// Faithful port of tehn/mlr v2.2.5

import { AudioEngine } from './audio-engine.js';
import { MonomeSerial, MonomeBridge } from './monome.js';
import { MidiManager } from './midi.js';
import { MlrCore, vREC, vCUT, vCLIP, mCUT, mSOLO, mMUTE, mONCE, MODE_NAMES, MODE_LABELS } from './mlr-core.js';
import { UI, setPill } from './ui.js';

const audio = new AudioEngine(6);
const ui = new UI();
let monome = null;

// ─── File loading ───

async function loadFilesIntoEngine(files, trackIndex) {
  const loaded = await audio.loadFiles(files);
  if (loaded.length && trackIndex != null) {
    audio.tracks[trackIndex].clipIndex = audio.clips.length - loaded.length + 1;
  }
  ui.setClipNames(audio.clips);
  setPill('audioStatus', `${loaded.length} clip(s) loaded`, 'ok');
}

ui.onDropFiles = (files, trackIndex) => loadFilesIntoEngine(files, trackIndex);
ui.onFilePick = (trackIndex) => {
  const picker = document.getElementById('filePicker');
  picker.onchange = async e => {
    await loadFilesIntoEngine(e.target.files, trackIndex);
    picker.onchange = null;
  };
  picker.click();
};

// ─── Core ───

const core = new MlrCore({
  audio,
  onRender: async (frame, state) => {
    ui.render(frame);
    ui.renderPatterns(state.patterns);
    ui.updateNav(state);
    ui.updateTrackModes(state.tracks);
    ui.updatePendingMode(state.pendingMode);
    await monome?.draw(frame);
  },
});

// ─── MIDI ───

const midi = new MidiManager({
  onClock: () => core.tick(audio.context?.currentTime ?? performance.now() / 1000),
  onStart: () => setPill('midiStatus', 'midi clock started', 'ok'),
  onStop: () => setPill('midiStatus', 'midi clock stopped', 'warn'),
  onStatus: text => setPill('midiStatus', text, 'ok'),
});

// ─── Grid input ───

ui.onPad(e => core.handleGridKey(e, now()));

// ─── Controls ───

document.getElementById('startAudio').onclick = async () => {
  await audio.start();
  setPill('audioStatus', 'audio ready', 'ok');
};

document.getElementById('filePicker').onchange = async e => {
  await loadFilesIntoEngine(e.target.files, null);
};

document.getElementById('bpm').oninput = e => core.setBpm(e.target.value);

// ─── Monome connection ───

document.getElementById('connectMonome').onclick = async () => {
  const keyHandler = e => { core.handleGridKey(e, now()); };
  const statusHandler = s => {
    console.log('[monome status]', s);
    setPill('monomeStatus', s, s.startsWith('connected') || s === 'bridge connected' ? 'ok' : 'warn');
  };
  try {
    statusHandler('connecting to bridge...');
    monome = new MonomeBridge({ onKey: keyHandler, onStatus: statusHandler });
    await monome.connect();
    statusHandler('monome connected via bridge');
    return;
  } catch (err) {
    console.log('[monome] bridge failed:', err.message);
    statusHandler('bridge failed: ' + err.message);
  }
  try {
    statusHandler('connecting via Web Serial...');
    monome = new MonomeSerial({ onKey: keyHandler, onStatus: statusHandler });
    await monome.connect();
    statusHandler('monome connected via USB');
  } catch (err) {
    console.log('[monome] serial failed:', err.message);
    setPill('monomeStatus', 'failed: ' + err.message, 'err');
  }
};

// ─── MIDI connection ───

document.getElementById('connectMidi').onclick = async () => {
  try {
    await midi.enable();
  } catch (err) {
    setPill('midiStatus', err.message, 'err');
  }
};

// ─── Pattern buttons (HTML fallback) ───

document.querySelectorAll('[data-pattern-action]').forEach(button => {
  button.addEventListener('click', () => {
    const slot = Number(button.dataset.patternSlot);
    const p = core.patterns[slot];
    if (button.dataset.patternAction === 'record') {
      if (p.recording) {
        core.stopPatternRecord(slot);
        core.startPatternPlayback(slot);
      } else {
        core.startPatternRecord(slot);
      }
    }
    if (button.dataset.patternAction === 'play') {
      if (p.playing) core.stopPatternPlayback(slot);
      else core.startPatternPlayback(slot);
    }
  });
});

// ─── Nav button handlers (on-screen reference panel) ───

document.getElementById('fn-rec')?.addEventListener('click', () => core.setView(vREC));
document.getElementById('fn-cut')?.addEventListener('click', () => core.setView(vCUT));
document.getElementById('fn-clip')?.addEventListener('click', () => core.setView(vCLIP));
document.getElementById('fn-quantize')?.addEventListener('click', () => {
  core.quantize = 1 - core.quantize;
  core.render();
});

// ─── Keyboard alt modifier ───

window.addEventListener('keydown', e => {
  if (e.key === 'Alt') {
    core.alt = 1;
    core.render();
  }
});
window.addEventListener('keyup', e => {
  if (e.key === 'Alt') {
    core.alt = 0;
    core.render();
  }
});

// ─── Main loop ───

function now() {
  return audio.context?.currentTime ?? performance.now() / 1000;
}

function loop() {
  if (audio.context) core.tick(audio.context.currentTime);
  requestAnimationFrame(loop);
}
loop();
core.render();
