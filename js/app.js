import {AudioEngine} from './audio-engine.js';
import {MonomeSerial} from './monome.js';
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

const core = new MlrCore({audio, onRender: async (frame, state) => { ui.render(frame); ui.renderPatterns(state.patterns); await monome?.draw(frame); }});
const midi = new MidiManager({
  onClock: () => core.tick(audio.context?.currentTime ?? performance.now()/1000),
  onStart: () => setPill('midiStatus','midi clock started','ok'),
  onStop: () => setPill('midiStatus','midi clock stopped','warn'),
  onStatus: text => setPill('midiStatus', text, 'ok')
});

ui.onPad(e => core.handleGridKey(e, now()));

document.getElementById('startAudio').onclick = async () => { await audio.start(); setPill('audioStatus','audio ready','ok'); };
document.getElementById('filePicker').onchange = async e => { await loadFilesIntoEngine(e.target.files, null); };
document.getElementById('bpm').oninput = e => core.setBpm(e.target.value);
document.getElementById('quantize').onchange = e => core.setQuantize(e.target.checked);
document.getElementById('connectMonome').onclick = async () => {
  try{ monome = new MonomeSerial({onKey:e=>{console.log('[monome] key:', e.x, e.y, e.state?'down':'up'); core.handleGridKey(e, now());}, onStatus:s=>setPill('monomeStatus',s,s==='connected'||s.startsWith('connected')?'ok':'warn')}); await monome.connect(); }
  catch(err){ setPill('monomeStatus',err.message,'err'); }
};
document.getElementById('connectMidi').onclick = async () => { try{ await midi.enable(); } catch(err){ setPill('midiStatus',err.message,'err'); } };

document.querySelectorAll('[data-pattern-action]').forEach(button => {
  button.addEventListener('click', () => {
    const slot = Number(button.dataset.patternSlot);
    if(button.dataset.patternAction === 'record') core.togglePatternRecord(slot, now());
    if(button.dataset.patternAction === 'play') core.togglePatternPlayback(slot, now());
  });
});

function now(){ return audio.context?.currentTime ?? performance.now()/1000; }

function loop(){ if(audio.context) core.tick(audio.context.currentTime); requestAnimationFrame(loop); }
loop(); core.render();
