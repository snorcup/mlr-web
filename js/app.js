import {AudioEngine} from './audio-engine.js';
import {MonomeSerial, MonomeBridge} from './monome.js';
import {MidiManager} from './midi.js';
import {MlrCore} from './mlr-core.js';
import {UI, setPill} from './ui.js';

const audio = new AudioEngine(7);
const ui = new UI();
let monome = null;

async function loadFilesIntoEngine(files, trackIndex){
  const loaded = await audio.loadFiles(files);
  if(loaded.length && trackIndex != null){
    // Assign the first loaded clip to the target track
    audio.tracks[trackIndex].clipIndex = audio.clips.length - loaded.length;
  }
  ui.setClipNames(audio.clips);
  setPill('audioStatus', `${loaded.length} clip(s) loaded`, 'ok');
}

ui.onDropFiles = (files, trackIndex) => loadFilesIntoEngine(files, trackIndex);
ui.onFilePick = (trackIndex) => {
  const picker = document.getElementById('filePicker');
  picker.onchange = async e => { await loadFilesIntoEngine(e.target.files, trackIndex); picker.onchange = null; };
  picker.click();
};

const core = new MlrCore({audio, onRender: async (frame, state) => {
  ui.render(frame);
  ui.renderPatterns(state.patterns);
  updateFnReference(state);
  updateTrackModeLabels();
  await monome?.draw(frame);
}});
const midi = new MidiManager({
  onClock: () => core.tick(audio.context?.currentTime ?? performance.now()/1000),
  onStart: () => setPill('midiStatus','midi clock started','ok'),
  onStop: () => setPill('midiStatus','midi clock stopped','warn'),
  onStatus: text => setPill('midiStatus', text, 'ok')
});

ui.onPad(e => core.handleGridKey(e, now()));

function updateFnReference(state){
  // View buttons
  document.getElementById('fn-cut').classList.toggle('active', state.view === 'CUT');
  document.getElementById('fn-rec').classList.toggle('active', state.view === 'REC');
  document.getElementById('fn-time').classList.toggle('active', state.view === 'TIME');

  // Pattern play/record LEDs
  state.patterns.forEach((p, i) => {
    const playBtn = document.getElementById(`fn-p${i+1}-play`);
    const recBtn = document.getElementById(`fn-p${i+1}-rec`);
    if(playBtn) playBtn.classList.toggle('active', p.playing);
    if(recBtn) recBtn.classList.toggle('active', p.recording);
  });

  // Track mode buttons — lit when that mode is pending assignment
  const pendingMode = core._pendingMode;
  document.getElementById('fn-mode-cut').classList.toggle('active', pendingMode === 'CUT');
  document.getElementById('fn-mode-solo').classList.toggle('active', pendingMode === 'SOLO');
  document.getElementById('fn-mode-mute').classList.toggle('active', pendingMode === 'MUTE');
  document.getElementById('fn-mode-once').classList.toggle('active', pendingMode === 'ONCE');

  // Hint text per view / pending mode
  const hint = document.getElementById('fn-hint');
  if(hint){
    if(pendingMode){
      const modeLabels = {CUT:'CUT', SOLO:'SOLO', MUTE:'MUTE', ONCE:'ONCE'};
      const modeDescs = {
        CUT:  'tap a track row to set it to CUT mode (default: tap slice to loop, tap same to stop)',
        SOLO: 'tap a track row to SOLO it (mutes all other tracks)',
        MUTE: 'tap a track row to MUTE it (track will not play)',
        ONCE: 'tap a track row to set ONCE mode (plays through once, no loop)',
      };
      hint.textContent = `Mode: ${modeLabels[pendingMode]} selected — ${modeDescs[pendingMode]}. Tap same button to cancel.`;
    } else if(state.view === 'CUT') hint.textContent = 'CUT — Tap a track pad to loop from that slice. Tap the same pad again to stop.';
    else if(state.view === 'REC') hint.textContent = 'REC — Same as CUT. Press a REC button (P1–P4), perform slice hits, press again to stop recording.';
    else if(state.view === 'TIME') hint.textContent = 'TIME — Press a track pad to set loop start. Press again for loop end. Playback loops within the region.';
  }
}

document.getElementById('startAudio').onclick = async () => { await audio.start(); setPill('audioStatus','audio ready','ok'); };
document.getElementById('filePicker').onchange = async e => { await loadFilesIntoEngine(e.target.files, null); };
document.getElementById('bpm').oninput = e => core.setBpm(e.target.value);
document.getElementById('quantize').onchange = e => core.setQuantize(e.target.checked);
document.getElementById('connectMonome').onclick = async () => {
  const keyHandler = e => { core.handleGridKey(e, now()); };
  const statusHandler = s => setPill('monomeStatus', s, s==='connected'||s.startsWith('connected')?'ok':'warn');
  // Try bridge first (serialosc -> WebSocket bridge on localhost:8089)
  try{
    monome = new MonomeBridge({onKey:keyHandler, onStatus:statusHandler});
    await monome.connect();
    return;
  }catch(err){
    console.log('[monome] bridge failed:', err.message);
  }
  // Fall back to Web Serial (monomes that speak binary serial protocol directly)
  try{
    monome = new MonomeSerial({onKey:keyHandler, onStatus:statusHandler});
    await monome.connect();
  }catch(err){
    setPill('monomeStatus', err.message, 'err');
  }
};
document.getElementById('connectMidi').onclick = async () => { try{ await midi.enable(); } catch(err){ setPill('midiStatus',err.message,'err'); } };

document.querySelectorAll('[data-pattern-action]').forEach(button => {
  button.addEventListener('click', () => {
    const slot = Number(button.dataset.patternSlot);
    if(button.dataset.patternAction === 'record') core.togglePatternRecord(slot, now());
    if(button.dataset.patternAction === 'play') core.togglePatternPlayback(slot, now());
  });
});

function updateTrackModeLabels(){
  const modes = core._trackModes;
  for(let i=0;i<modes.length;i++){
    const el = document.getElementById(`track-mode-${i}`);
    if(el){
      const m = modes[i];
      if(m === 'CUT'){ el.textContent = ''; el.className = 'track-mode'; }
      else if(m === 'SOLO'){ el.textContent = 'S'; el.className = 'track-mode mode-solo'; }
      else if(m === 'MUTE'){ el.textContent = 'M'; el.className = 'track-mode mode-mute'; }
      else if(m === 'ONCE'){ el.textContent = '1'; el.className = 'track-mode mode-once'; }
    }
  }
}

function now(){ return audio.context?.currentTime ?? performance.now()/1000; }

function loop(){ if(audio.context) core.tick(audio.context.currentTime); requestAnimationFrame(loop); }
loop();
core.render();
updateFnReference(core.state);
