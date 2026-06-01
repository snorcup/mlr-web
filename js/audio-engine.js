export class AudioEngine {
  constructor(trackCount=7){
    this.context = null; this.master = null; this.clips = []; this.tracks = Array.from({length:trackCount}, (_,i)=>this.makeTrack(i));
  }
  makeTrack(index){ return {index, clipIndex:index, source:null, gain:null, playing:false, startedAt:0, offset:0, rate:1, loop:true, loopStart:0, loopEnd:null, volume:0.9}; }
  async start(){
    this.context ??= new AudioContext({latencyHint:'interactive'});
    this.master ??= new GainNode(this.context, {gain:0.95});
    this.master.connect(this.context.destination);
    await this.context.resume();
  }
  async loadFiles(files){
    await this.start();
    const loaded=[];
    for(const file of files){
      const array = await file.arrayBuffer();
      const buffer = await this.context.decodeAudioData(array);
      const clip = {name:file.name, buffer, duration:buffer.duration};
      this.clips.push(clip); loaded.push(clip);
    }
    return loaded;
  }
  ensureClip(track){ return this.clips[track.clipIndex] ?? this.clips[0]; }
  playTrack(trackIndex, slice=0){
    const track=this.tracks[trackIndex]; const clip=this.ensureClip(track); if(!clip) return false;
    this.stopTrack(trackIndex, false);
    const source = new AudioBufferSourceNode(this.context, {buffer:clip.buffer, playbackRate:track.rate});
    const gain = new GainNode(this.context, {gain:track.volume});
    const sliceOffset = (Math.max(0,Math.min(15,slice)) / 16) * clip.duration;
    source.loop = track.loop;
    source.loopStart = track.loop ? sliceOffset : 0;
    source.loopEnd = track.loop ? clip.duration : clip.duration;
    source.connect(gain).connect(this.master);
    source.start(0, sliceOffset);
    track.source=source; track.gain=gain; track.playing=true; track.startedAt=this.context.currentTime; track.offset=sliceOffset;
    source.onended = () => { if(track.source===source){ track.playing=false; track.source=null; } };
    return true;
  }
  jump(trackIndex, slice){ return this.playTrack(trackIndex, slice); }
  stopTrack(trackIndex, markStopped=true){ const track=this.tracks[trackIndex]; try{ track.source?.stop(); }catch{} if(markStopped) track.playing=false; track.source=null; }
  setVolume(trackIndex, value){ const track=this.tracks[trackIndex]; track.volume=Math.max(0,Math.min(1,Number(value))); if(track.gain) track.gain.gain.value=track.volume; }
  setRate(trackIndex, value){ const track=this.tracks[trackIndex]; track.rate=Number(value)||1; if(track.source) track.source.playbackRate.value=track.rate; }
  positionSlice(trackIndex){
    const track=this.tracks[trackIndex]; const clip=this.ensureClip(track); if(!clip || !track.playing) return -1;
    const elapsed=(this.context.currentTime-track.startedAt)*Math.abs(track.rate);
    const pos=(track.offset+elapsed)%clip.duration;
    return Math.floor((pos/clip.duration)*16);
  }
}
