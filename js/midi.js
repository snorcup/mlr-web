export class MidiManager {
  constructor({onClock=()=>{}, onStart=()=>{}, onStop=()=>{}, onMessage=()=>{}, onStatus=()=>{}} = {}){
    this.access = null; this.enabled = false; this.clockTicks = 0;
    this.handlers = {onClock,onStart,onStop,onMessage,onStatus};
  }
  get supported(){ return 'requestMIDIAccess' in navigator; }
  async enable(){
    if(!this.supported) throw new Error('Web MIDI API is not available in this browser.');
    this.access = await navigator.requestMIDIAccess({sysex:false});
    this.enabled = true;
    for (const input of this.access.inputs.values()) input.onmidimessage = e => this.handleMessage(e);
    this.access.onstatechange = () => { for (const input of this.access.inputs.values()) input.onmidimessage = e => this.handleMessage(e); this.handlers.onStatus(this.summary()); };
    this.handlers.onStatus(this.summary());
  }
  summary(){ return `${this.access?.inputs.size ?? 0} MIDI input(s)`; }
  handleMessage(event){
    const [status,data1,data2] = event.data;
    if(status === 0xF8){ this.clockTicks++; this.handlers.onClock({ticks:this.clockTicks, time:event.timeStamp}); return; }
    if(status === 0xFA){ this.clockTicks = 0; this.handlers.onStart({time:event.timeStamp}); return; }
    if(status === 0xFC){ this.handlers.onStop({time:event.timeStamp}); return; }
    this.handlers.onMessage({status,data1,data2,time:event.timeStamp});
  }
}

export class InternalClock {
  constructor({bpm=120, subdivision=4}={}){ this.bpm=bpm; this.subdivision=subdivision; this.nextTime=0; }
  setBpm(bpm){ this.bpm = Math.max(20, Math.min(300, Number(bpm) || 120)); }
  intervalSeconds(){ return 60 / this.bpm / this.subdivision; }
  shouldTick(now){ if(!this.nextTime) this.nextTime=now; if(now >= this.nextTime){ this.nextTime += this.intervalSeconds(); return true; } return false; }
}
