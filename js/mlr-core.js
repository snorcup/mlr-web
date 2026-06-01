import {InternalClock} from './midi.js';

const GRID_ROWS = 8;
const GRID_COLS = 16;
const FUNCTION_ROW = GRID_ROWS - 1;
const PATTERN_COUNT = 4;
const TIME_EPSILON = 0.000001;

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
    this._stopping = false; // re-entrancy guard
  }
  setBpm(bpm){ this.clock.setBpm(bpm); }
  setQuantize(on){ this.state.quantize=!!on; this.render(); }
  handleGridKey({x,y,state}, now=0){
    if(y===FUNCTION_ROW){
      if(state && x<3) this.state.view=['CUT','REC','TIME'][x];
      if(state && x===3) this.stopAll(now);
      if(state && x>=8 && x<=11) this.togglePatternPlayback(x-8, now);
      if(state && x>=12 && x<=15) this.togglePatternRecord(x-12, now);
      this.render();
      return;
    }
    if(!state || y<0 || y>=this.state.tracks.length) return;
    const slice = sliceForPad(x);

    // TIME mode: set loop start/end per track
    if(this.state.view === 'TIME'){
      this.handleTimeMode(y, slice);
      return;
    }

    // CUT / REC mode: trigger/stop toggle
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
    f[FUNCTION_ROW][0]=this.state.view==='CUT'?12:3;
    f[FUNCTION_ROW][1]=this.state.view==='REC'?12:3;
    f[FUNCTION_ROW][2]=this.state.view==='TIME'?12:3;
    // STOP indicator: lit when any track is active
    const anyPlaying = this._activeSlices.some(s => s >= 0);
    f[FUNCTION_ROW][3] = anyPlaying ? 12 : 2;
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
