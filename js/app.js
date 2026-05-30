import {AudioEngine} from './audio-engine.js';
import {MonomeSerial} from './monome.js';
import {MidiManager} from './midi.js';
import {MlrCore} from './mlr-core.js';
import {UI, setPill} from './ui.js';

const audio = new AudioEngine(7);
const ui = new UI();
let monome = null;
const core = new MlrCore({audio, onRender: async frame => { ui.render(frame); await monome?.draw(frame); }});
const midi = new MidiManager({
  onClock: () => core.tick(audio.context?.currentTime ?? performance.now()/1000),
  onStart: () => setPill('midiStatus','midi clock started','ok'),
  onStop: () => setPill('midiStatus','midi clock stopped','warn'),
  onStatus: text => setPill('midiStatus', text, 'ok')
});

ui.onPad(e => core.handleGridKey(e));

document.getElementById('startAudio').onclick = async () => { await audio.start(); setPill('audioStatus','audio ready','ok'); };
document.getElementById('filePicker').onchange = async e => { const loaded = await audio.loadFiles(e.target.files); ui.setClipNames(audio.clips); setPill('audioStatus',`${loaded.length} clip(s) loaded`,'ok'); };
document.getElementById('bpm').oninput = e => core.setBpm(e.target.value);
document.getElementById('quantize').onchange = e => core.setQuantize(e.target.checked);
document.getElementById('connectMonome').onclick = async () => {
  try{ monome = new MonomeSerial({onKey:e=>core.handleGridKey(e), onStatus:s=>setPill('monomeStatus',s,s==='connected'?'ok':'warn')}); await monome.connect(); }
  catch(err){ setPill('monomeStatus',err.message,'err'); }
};
document.getElementById('connectMidi').onclick = async () => { try{ await midi.enable(); } catch(err){ setPill('midiStatus',err.message,'err'); } };

function loop(){ if(audio.context) core.tick(audio.context.currentTime); requestAnimationFrame(loop); }
loop(); core.render();
