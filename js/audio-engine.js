// audio-engine.js — softcut-like audio engine for web-mlr
// 6 tracks, 16 clips, per-track rate/reverse/loop/volume/fade

export class AudioEngine {
  constructor(trackCount = 6) {
    this.context = null;
    this.master = null;
    this.clips = []; // { name, buffer, duration }
    this.tracks = Array.from({ length: trackCount }, (_, i) => this.makeTrack(i));
    this.phasePollInterval = null;
  }

  makeTrack(index) {
    return {
      index,
      clipIndex: index + 1, // 1-indexed clip assignment
      source: null,
      gain: null,
      playing: false,
      startedAt: 0,
      offset: 0,
      rate: 1,
      loop: true,
      loopStart: 0,
      loopEnd: null, // null = full clip
      volume: 1,
      muted: false,
      rec: 0,
      fadeTime: 0.01, // OG: FADE = 0.01
      levelSlew: 0.1,  // OG: level_slew_time = 0.1
    };
  }

  async start() {
    this.context ??= new AudioContext({ latencyHint: 'interactive' });
    this.master ??= new GainNode(this.context, { gain: 0.95 });
    this.master.connect(this.context.destination);
    await this.context.resume();
    this.startPhasePoll();
  }

  startPhasePoll() {
    if (this.phasePollInterval) return;
    this.phasePollInterval = setInterval(() => {
      this.pollPhase();
    }, 50); // 50ms poll for playhead position
  }

  stopPhasePoll() {
    if (this.phasePollInterval) {
      clearInterval(this.phasePollInterval);
      this.phasePollInterval = null;
    }
  }

  async loadFiles(files) {
    await this.start();
    const loaded = [];
    for (const file of files) {
      const array = await file.arrayBuffer();
      const buffer = await this.context.decodeAudioData(array);
      const clip = { name: file.name, buffer, duration: buffer.duration };
      this.clips.push(clip);
      loaded.push(clip);
    }
    return loaded;
  }

  ensureClip(track) {
    const clipIdx = track.clipIndex;
    if (clipIdx >= 1 && clipIdx <= this.clips.length) {
      return this.clips[clipIdx - 1];
    }
    return this.clips[0] ?? null;
  }

  // ─── Core playback ───

  playTrack(trackIndex, slice = 0) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return false;
    const clip = this.ensureClip(track);
    if (!clip) return false;

    this.stopTrack(trackIndex, false);

    const source = new AudioBufferSourceNode(this.context, {
      buffer: clip.buffer,
      playbackRate: track.rate,
      loop: track.loop,
    });

    const gain = new GainNode(this.context, {
      gain: track.muted ? 0 : track.volume,
    });

    const sliceOffset = (Math.max(0, Math.min(15, slice)) / 16) * clip.duration;

    // Set loop points
    if (track.loop) {
      if (track.loopEnd !== null) {
        source.loopStart = (track.loopStart / 16) * clip.duration;
        source.loopEnd = (track.loopEnd / 16) * clip.duration;
      } else {
        source.loopStart = sliceOffset;
        source.loopEnd = clip.duration;
      }
    }

    source.connect(gain).connect(this.master);
    source.start(0, sliceOffset);

    track.source = source;
    track.gain = gain;
    track.playing = true;
    track.startedAt = this.context.currentTime;
    track.offset = sliceOffset;

    source.onended = () => {
      if (track.source === source) {
        track.playing = false;
        track.source = null;
      }
    };

    return true;
  }

  jump(trackIndex, slice) {
    return this.playTrack(trackIndex, slice);
  }

  stopTrack(trackIndex, markStopped = true) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    try { track.source?.stop(); } catch {}
    if (markStopped) track.playing = false;
    track.source = null;
  }

  // ─── Per-track controls ───

  setVolume(trackIndex, value) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    track.volume = Math.max(0, Math.min(1, Number(value)));
    if (track.gain && !track.muted) {
      track.gain.gain.setTargetAtTime(track.volume, this.context.currentTime, track.levelSlew / 3);
    }
  }

  setLevel(trackIndex, level) {
    // Immediate level change (for lag-based fade in/out)
    const track = this.tracks[trackIndex - 1];
    if (!track || !track.gain) return;
    track.gain.gain.setValueAtTime(level, this.context.currentTime);
  }

  setRate(trackIndex, rate) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    track.rate = Number(rate) || 1;
    if (track.source) {
      track.source.playbackRate.setValueAtTime(track.rate, this.context.currentTime);
    }
  }

  setLoop(trackIndex, enabled, start = 0, end = 16) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    track.loop = enabled;
    track.loopStart = start;
    track.loopEnd = end;

    if (track.source) {
      if (enabled) {
        const clip = this.ensureClip(track);
        track.source.loop = true;
        track.source.loopStart = (start / 16) * clip.duration;
        track.source.loopEnd = (end / 16) * clip.duration;
      } else {
        track.source.loop = false;
      }
    }
  }

  setPlay(trackIndex, playing) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    if (playing) {
      this.playTrack(trackIndex, 0);
    } else {
      this.stopTrack(trackIndex);
    }
  }

  setRec(trackIndex, rec) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    track.rec = rec ? 1 : 0;
  }

  setMuted(trackIndex, muted) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    track.muted = muted;
    if (track.gain) {
      track.gain.gain.setTargetAtTime(
        muted ? 0 : track.volume,
        this.context.currentTime,
        track.levelSlew / 3
      );
    }
  }

  assignClip(trackIndex, clipIndex) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    track.clipIndex = clipIndex;
  }

  // ─── Phase polling (playhead position) ───

  pollPhase() {
    if (!this.context) return;
    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      if (!track.playing || !track.source) {
        track.pos_grid = -1;
        continue;
      }
      const clip = this.ensureClip(track);
      if (!clip) continue;

      const elapsed = (this.context.currentTime - track.startedAt) * Math.abs(track.rate);
      let pos;
      if (track.loop && track.loopEnd !== null) {
        const loopStart = (track.loopStart / 16) * clip.duration;
        const loopEnd = (track.loopEnd / 16) * clip.duration;
        const loopLen = loopEnd - loopStart;
        pos = loopLen > 0 ? loopStart + (elapsed % loopLen) : loopStart;
      } else {
        pos = track.offset + elapsed;
      }
      const slicePos = Math.floor((pos / clip.duration) * 16);
      track.pos_grid = Math.max(0, Math.min(15, slicePos));
    }
  }

  positionSlice(trackIndex) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return -1;
    return track.pos_grid ?? -1;
  }

  // ─── Buffer management ───

  clearBuffer() {
    this.clips = [];
    for (const track of this.tracks) {
      this.stopTrack(track.index + 1);
    }
  }
}
