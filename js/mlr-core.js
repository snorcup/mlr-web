import {InternalClock} from './midi.js';

export class MlrCore {
  constructor({tracks=7, onRender=()=>{}, audio=null}={}){
    this.audio=audio; this.onRender=onRender; this.clock=new InternalClock({bpm:120, subdivision:4});
    this.state={view:'CUT', quantize:true, modifier:false, queued:[], tracks:Array.from({length:tracks},(_,i)=>({clipIndex:i, muted:false, speed:1, group:i}))};
  }
  setBpm(bpm){ this.clock.setBpm(bpm); }
  setQuantize(on){ this.state.quantize=!!on; }
  setModifier(on){ this.state.modifier=!!on; this.render(); }
  handleGridKey({x,y,state}){
    if(y===7){ if(x===7) this.setModifier(state); if(state && x<3) this.state.view=['CUT','REC','TIME'][x]; this.render(); return; }
    if(!state) return;
    const slice = x + (this.state.modifier ? 8 : 0);
    const event={track:y, slice};
    if(this.state.quantize) this.state.queued.push(event); else this.exec(event);
  }
  tick(now){ if(this.state.quantize && this.clock.shouldTick(now)){ const q=this.state.queued.splice(0); q.forEach(e=>this.exec(e)); } this.render(); }
  exec({track,slice}){ this.audio?.jump(track,slice); }
  framebuffer(){
    const f=Array.from({length:8},()=>Array(8).fill(0));
    for(let y=0;y<7;y++){
      const pos=this.audio?.positionSlice(y) ?? -1;
      if(pos>=0){ const visible = this.state.modifier ? pos>=8 : pos<8; if(visible) f[y][pos%8]=15; }
    }
    f[7][0]=this.state.view==='CUT'?12:3; f[7][1]=this.state.view==='REC'?12:3; f[7][2]=this.state.view==='TIME'?12:3; f[7][6]=this.state.quantize?8:0; f[7][7]=this.state.modifier?15:5;
    return f;
  }
  render(){ this.onRender(this.framebuffer(), this.state); }
}

export function sliceForPad(x, modifier){ return x + (modifier ? 8 : 0); }
