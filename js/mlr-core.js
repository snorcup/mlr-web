import {InternalClock} from './midi.js';

const GRID_ROWS = 8;
const GRID_COLS = 16;
const FUNCTION_ROW = GRID_ROWS - 1;
const PATTERN_COUNT = 4;
const TIME_EPSILON = 0.000001;

// Per-track mode button positions on the function row
const MODE_CUT  = 4;  // x=4: CUT (default toggle loop/stop)
const MODE_SOLO = 5;  // x=5: SOLO (solo this track)
const MODE_MUTE = 6;  // x=6: MUTE (toggle mute)
const MODE_ONCE = 7;  // x=7: ONCE (one-shot, no loop)

export const TRACK_MODES = ['CUT','SOLO','MUTE','ONCE'];

export class MlrCore {
  constructor({tracks=7, onRender=()=>{}, audio=null}={}){
    this.audio=audio;
    this.onRender=onRender;
    this.clock=new InternalClock({bpm:120, subdivision:4});
    this.state={
      view:'CUT',
      quantize:true,
      queued:[],
      tracks:Array.from({length:tracks},(_,i)=>({clipIndex:i, muted:false, speed:1, group:i})),
      patterns:Array.from({length:PATTERN_COUNT},()=>makePattern())
    };
    // Track last active slice per track for toggle-stop
    this._activeSlices = Array.from({length:tracks}, () => -1);
    // Per-track mode: one of 'CUT','SOLO','MUTE','ONCE' — which mode button is pending assignment
    this._pendingMode = null; // null or one of TRACK_MODES
    this._trackModes = Array.from({length:tracks}, () => 'CUT'); // effective mode per track
    this._stopping = false; // re-entrancy guard
  }
  setBpm(bpm){ this.clock.setBpm(bpm); }
  setQuantize(on){ this.state.quantize=!!on; this.render(); }
  handleGridKey({x,y,state}, now=0){
    if(y===FUNCTION_ROW){
      // View mode buttons (x=0-2)
      if(state && x<3) this.state.view=['CUT','REC','TIME'][x];
      // STOP ALL (x=3)
      if(state && x===3) this.stopAll(now);
      // Pattern playback (x=8-11)
      if(state && x>=8 && x<=11) this.togglePatternPlayback(x-8, now);
      // Pattern record (x=12-15)
      if(state && x>=12 && x<=15) this.togglePatternRecord(x-12, now);
      // Per-track mode buttons (x=4-7)
      if(state && x>=4 && x<=7){
        const mode = TRACK_MODES[x-4];
        if(this._pendingMode === mode){
          // Press same mode button again to cancel
          this._pendingMode = null;
        } else {
          this._pendingMode = mode;
        }
      }
      this.render();
      return;
    }
    if(!state || y<0 || y>=this.state.tracks.length) return;

    // If a mode is pending, apply it to this track row and clear pending
    if(this._pendingMode !== null){
      this.applyTrackMode(y, this._pendingMode);
      this._pendingMode = null;
      this.render();
      return;
    }

    const slice = sliceForPad(x);

    // TIME mode: set loop start/end per track
    if(this.state.view === 'TIME'){
      this.handleTimeMode(y, slice);
      return;
    }

    // CUT / REC mode: trigger/stop toggle (respecting per-track mode)
    const trackMode = this._trackModes[y];

    if(trackMode === 'MUTE'){
      // Muted track: ignore slice presses
      return;
    }

    if(trackMode === 'ONCE'){
      // One-shot mode: always restart from pressed slice, no toggle-stop
      this.audio?.setOnce?.(y, true);
      const event={track:y, slice};
      this.recordPatternEvent(event, now);
      if(this.state.quantize) this.state.queued.push(event); else this.exec(event);
      this._activeSlices[y] = slice;
      return;
    }

    if(trackMode === 'SOLO'){
      // Solo this track: mute all others, then trigger
      this.audio?.setMuted?.(y, false);
      for(let i=0;i<this.state.tracks.length;i++){
        if(i!==y) this.audio?.setMuted?.(i, true);
      }
    }

    // CUT mode (default): toggle stop on same pad
    if(this._activeSlices[y] === slice){
      if(this._stopping) return;
      this._stopping = true;
      this.stopTrack(y);
      this._activeSlices[y] = -1;
      this._stopping = false;
      this.render();
      return;
    }
    const event={track:y, slice};
    this.recordPatternEvent(event, now);
    if(this.state.quantize) this.state.queued.push(event); else this.exec(event);
    this._activeSlices[y] = slice;
  }

  applyTrackMode(trackIndex, mode){
    this._trackModes[trackIndex] = mode;
    if(mode === 'MUTE'){
      this.audio?.setMuted?.(trackIndex, true);
    } else {
      // Unmute when switching away from MUTE
      this.audio?.setMuted?.(trackIndex, false);
    }
    if(mode === 'ONCE'){
      this.audio?.setOnce?.(trackIndex, true);
    } else {
      this.audio?.setOnce?.(trackIndex, false);
    }
    if(mode === 'SOLO'){
      // Solo: mute all other tracks
      for(let i=0;i<this.state.tracks.length;i++){
        this.audio?.setMuted?.(i, i!==trackIndex);
      }
    } else {
      // Unsolo: unmute all (unless MUTE mode is set on them)
      for(let i=0;i<this.state.tracks.length;i++){
        if(this._trackModes[i] !== 'MUTE'){
          this.audio?.setMuted?.(i, false);
        }
      }
    }
    this.render();
  }

  handleTimeMode(trackIndex, slice){
    const track = this.audio?.tracks?.[trackIndex];
    if(!track) return;
    if(track.loopStart === 0 && track.loopEnd === null){
      // First press: set loop start
      const clip = this.audio?.clips?.[track.clipIndex];
      if(!clip) return;
      track.loopStart = (slice / 16) * clip.duration;
      track.loopEnd = clip.duration; // default end = full clip
    } else {
      // Second press: set loop end, then reset
      const clip = this.audio?.clips?.[track.clipIndex];
      if(!clip) return;
      const endPos = (slice / 16) * clip.duration;
      if(endPos > track.loopStart + 0.01){
        track.loopEnd = endPos;
      }
      // Reset so next press starts fresh
      track.loopStart = 0;
      track.loopEnd = null;
    }
    this.render();
  }
  stopAll(now=0){
    for(let i=0;i<this.state.tracks.length;i++) this.stopTrack(i);
    this._activeSlices.fill(-1);
  }
  stopTrack(trackIndex){
    this.audio?.stopTrack?.(trackIndex);
    this._activeSlices[trackIndex] = -1;
    // Remove any queued events for this track so stop is immediate
    this.state.queued = this.state.queued.filter(e => e.track !== trackIndex);
    this.render();
  }
  tick(now){
    if(this.state.quantize && this.clock.shouldTick(now)){
      const q=this.state.queued.splice(0);
      q.forEach(e=>this.exec(e));
    }
    this.tickPatterns(now);
    this.render();
  }
  exec({track,slice}){ this.audio?.jump?.(track,slice); }
  startPatternRecord(slot, now=0){
    const pattern=this.pattern(slot);
    pattern.events=[];
    pattern.length=0;
    pattern.recording=true;
    pattern.playing=false;
    pattern.recordStartedAt=now;
    pattern.playStartedAt=0;
    pattern.lastCycle=0;
    pattern.lastPhase=0;
    this.render();
  }
  stopPatternRecord(slot, now=0){
    const pattern=this.pattern(slot);
    pattern.recording=false;
    pattern.length=Math.max(0.25, roundTime(now - pattern.recordStartedAt));
    pattern.recordStartedAt=0;
    this.render();
  }
  togglePatternRecord(slot, now=0){
    const pattern=this.pattern(slot);
    if(pattern.recording) this.stopPatternRecord(slot, now);
    else this.startPatternRecord(slot, now);
  }
  startPatternPlayback(slot, now=0){
    const pattern=this.pattern(slot);
    if(!pattern.events.length || pattern.length<=0) return false;
    pattern.playing=true;
    pattern.playStartedAt=now;
    pattern.lastCycle=0;
    pattern.lastPhase=0;
    this.render();
    return true;
  }
  stopPatternPlayback(slot){
    const pattern=this.pattern(slot);
    pattern.playing=false;
    this.render();
  }
  togglePatternPlayback(slot, now=0){
    const pattern=this.pattern(slot);
    if(pattern.playing){ this.stopPatternPlayback(slot); return false; }
    return this.startPatternPlayback(slot, now);
  }
  recordPatternEvent(event, now=0){
    for(const pattern of this.state.patterns){
      if(!pattern.recording) continue;
      pattern.events.push({...event, time:roundTime(now - pattern.recordStartedAt)});
    }
  }
  tickPatterns(now=0){
    for(const pattern of this.state.patterns){
      if(!pattern.playing || !pattern.events.length || pattern.length<=0) continue;
      const elapsed=Math.max(0, now - pattern.playStartedAt);
      const cycle=Math.floor(elapsed / pattern.length);
      const phase=roundTime(elapsed % pattern.length);
      const due = cycle > pattern.lastCycle
        ? pattern.events.filter(e=>e.time > pattern.lastPhase + TIME_EPSILON || e.time <= phase + TIME_EPSILON)
        : pattern.events.filter(e=>e.time > pattern.lastPhase + TIME_EPSILON && e.time <= phase + TIME_EPSILON);
      due.sort((a,b)=>a.time-b.time).forEach(e=>this.exec(e));
      pattern.lastCycle=cycle;
      pattern.lastPhase=phase;
    }
  }
  pattern(slot){
    const index=Math.max(0,Math.min(PATTERN_COUNT-1,slot|0));
    return this.state.patterns[index];
  }
  framebuffer(){
    const f=Array.from({length:GRID_ROWS},()=>Array(GRID_COLS).fill(0));
    if(this.state.view === 'TIME'){
      // TIME mode: show loop start (bright) and loop end (dim) per track
      for(let y=0;y<this.state.tracks.length;y++){
        const track = this.audio?.tracks?.[y];
        const clip = track ? this.audio?.ensureClip?.(track) : null;
        if(track && clip){
          if(track.loopEnd !== null){
            // Loop region active: show start and end
            const startCol = Math.floor((track.loopStart / clip.duration) * 16);
            const endCol = Math.floor((track.loopEnd / clip.duration) * 16);
            for(let x=startCol; x<=endCol && x<16; x++) f[y][x] = (x===startCol) ? 12 : 4;
          } else {
            // First press made, waiting for end: show start
            const startCol = Math.floor((track.loopStart / clip.duration) * 16);
            f[y][startCol] = 12;
          }
        }
      }
    } else {
      // CUT / REC mode: show playhead
      for(let y=0;y<this.state.tracks.length;y++){
        const pos=this.audio?.positionSlice(y) ?? -1;
        if(pos>=0 && pos<GRID_COLS) f[y][pos]=15;
      }
    }
    // View mode LEDs
    f[FUNCTION_ROW][0]=this.state.view==='CUT'?12:3;
    f[FUNCTION_ROW][1]=this.state.view==='REC'?12:3;
    f[FUNCTION_ROW][2]=this.state.view==='TIME'?12:3;
    // STOP indicator: lit when any track is active
    const anyPlaying = this._activeSlices.some(s => s >= 0);
    f[FUNCTION_ROW][3] = anyPlaying ? 12 : 2;
    // Per-track mode buttons (x=4-7): lit when that mode is pending selection
    f[FUNCTION_ROW][MODE_CUT]  = this._pendingMode === 'CUT'  ? 12 : 3;
    f[FUNCTION_ROW][MODE_SOLO] = this._pendingMode === 'SOLO' ? 12 : 3;
    f[FUNCTION_ROW][MODE_MUTE] = this._pendingMode === 'MUTE' ? 12 : 3;
    f[FUNCTION_ROW][MODE_ONCE] = this._pendingMode === 'ONCE' ? 12 : 3;
    // Pattern LEDs
    this.state.patterns.forEach((pattern,i)=>{
      f[FUNCTION_ROW][8+i]=pattern.playing?12:(pattern.events.length?4:1);
      f[FUNCTION_ROW][12+i]=pattern.recording?15:3;
    });
    return f;
  }
  render(){ this.onRender(this.framebuffer(), this.state); }
}

export function sliceForPad(x){ return Math.max(0, Math.min(GRID_COLS - 1, x|0)); }

function makePattern(){
  return {events:[], length:0, recording:false, playing:false, recordStartedAt:0, playStartedAt:0, lastCycle:0, lastPhase:0};
}

function roundTime(value){ return Math.round(value * 1000000) / 1000000; }
