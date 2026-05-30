import {InternalClock} from './midi.js';

const GRID_ROWS = 8;
const GRID_COLS = 16;
const FUNCTION_ROW = GRID_ROWS - 1;

export class MlrCore {
  constructor({tracks=7, onRender=()=>{}, audio=null}={}){
    this.audio=audio; this.onRender=onRender; this.clock=new InternalClock({bpm:120, subdivision:4});
    this.state={view:'CUT', quantize:true, queued:[], tracks:Array.from({length:tracks},(_,i)=>({clipIndex:i, muted:false, speed:1, group:i}))};
  }
  setBpm(bpm){ this.clock.setBpm(bpm); }
  setQuantize(on){ this.state.quantize=!!on; this.render(); }
  handleGridKey({x,y,state}){
    if(y===FUNCTION_ROW){
      if(state && x<3) this.state.view=['CUT','REC','TIME'][x];
      if(state && x===14) this.setQuantize(!this.state.quantize);
      this.render();
      return;
    }
    if(!state || y<0 || y>=this.state.tracks.length) return;
    const event={track:y, slice:sliceForPad(x)};
    if(this.state.quantize) this.state.queued.push(event); else this.exec(event);
  }
  tick(now){ if(this.state.quantize && this.clock.shouldTick(now)){ const q=this.state.queued.splice(0); q.forEach(e=>this.exec(e)); } this.render(); }
  exec({track,slice}){ this.audio?.jump(track,slice); }
  framebuffer(){
    const f=Array.from({length:GRID_ROWS},()=>Array(GRID_COLS).fill(0));
    for(let y=0;y<this.state.tracks.length;y++){
      const pos=this.audio?.positionSlice(y) ?? -1;
      if(pos>=0 && pos<GRID_COLS) f[y][pos]=15;
    }
    f[FUNCTION_ROW][0]=this.state.view==='CUT'?12:3;
    f[FUNCTION_ROW][1]=this.state.view==='REC'?12:3;
    f[FUNCTION_ROW][2]=this.state.view==='TIME'?12:3;
    f[FUNCTION_ROW][14]=this.state.quantize?8:0;
    f[FUNCTION_ROW][15]=5;
    return f;
  }
  render(){ this.onRender(this.framebuffer(), this.state); }
}

export function sliceForPad(x){ return Math.max(0, Math.min(GRID_COLS - 1, x|0)); }
