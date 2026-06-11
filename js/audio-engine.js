// audio-engine.js — softcut-like audio engine for web-mlr
// 6 tracks, 16 clips, per-track rate/reverse/loop/volume/fade/mode

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
      mode: 'CUT', // CUT | SOLO | MUTE | ONCE
      rec: 0,
      fadeTime: 0.01,
      levelSlew: 0.1,
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
    }, 50);
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

    // If already playing at same slice, toggle off (stop)
    if (track.playing && track.offset === (Math.max(0, Math.min(15, slice)) / 16) * clip.duration) {
      this.stopTrack(trackIndex);
      return true;
    }

    this.stopTrack(trackIndex, false);

    const source = new AudioBufferSourceNode(this.context, {
      buffer: clip.buffer,
      playbackRate: track.rate,
      loop: track.mode === 'ONCE' ? false : track.loop,
    });

    const gain = new GainNode(this.context, {
      gain: track.muted ? 0 : track.volume,
    });

    const sliceOffset = (Math.max(0, Math.min(15, slice)) / 16) * clip.duration;

    // Set loop points
    if (track.loop && track.mode !== 'ONCE') {
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

    // Handle SOLO: mute all other tracks
    if (track.mode === 'SOLO') {
      for (let i = 0; i < this.tracks.length; i++) {
        if (i !== trackIndex - 1) {
          const other = this.tracks[i];
          if (other.gain && !other.muted) {
            other.gain.gain.setTargetAtTime(0, this.context.currentTime, other.levelSlew / 3);
          }
        }
      }
    }

    source.onended = () => {
      if (track.source === source) {
        track.playing = false;
        track.source = null;
      }
    };

    return true;
  }

  jump(trackIndex, slice) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return false;
    const clip = this.ensureClip(track);
    if (!clip) return false;

    if (!track.playing) {
      // Not playing — start from slice
      return this.playTrack(trackIndex, slice);
    }

    // Already playing — just reposition
    const sliceOffset = (Math.max(0, Math.min(15, slice)) / 16) * clip.duration;

    // Stop current source and start new one at position
    this.stopTrack(trackIndex, false);

    const source = new AudioBufferSourceNode(this.context, {
      buffer: clip.buffer,
      playbackRate: track.rate,
      loop: track.mode === 'ONCE' ? false : track.loop,
    });

    const gain = new GainNode(this.context, {
      gain: track.muted ? 0 : track.volume,
    });

    if (track.loop && track.mode !== 'ONCE') {
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

  stopTrack(trackIndex, markStopped = true) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    try { track.source?.stop(); } catch {}
    if (markStopped) track.playing = false;
    track.source = null;

    // If this track was SOLO, unmute others
    if (track.mode === 'SOLO') {
      for (let i = 0; i < this.tracks.length; i++) {
        const other = this.tracks[i];
        if (other.gain && !other.muted) {
          other.gain.gain.setTargetAtTime(other.volume, this.context.currentTime, other.levelSlew / 3);
        }
      }
    }
  }

  stopAll() {
    for (let i = 1; i <= this.tracks.length; i++) {
      this.stopTrack(i);
    }
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

  setMode(trackIndex, mode) {
    const track = this.tracks[trackIndex - 1];
    if (!track) return;
    const oldMode = track.mode;
    track.mode = mode;

    // Handle mode transitions
    if (mode === 'MUTE') {
      if (track.gain) {
        track.gain.gain.setTargetAtTime(0, this.context.currentTime, track.levelSlew / 3);
      }
    } else if (mode === 'SOLO') {
      // Mute all other tracks
      for (let i = 0; i < this.tracks.length; i++) {
        if (i !== trackIndex - 1) {
          const other = this.tracks[i];
          if (other.gain) {
            other.gain.gain.setTargetAtTime(0, this.context.currentTime, other.levelSlew / 3);
          }
        }
      }
      // Unmute this track
      if (track.gain && !track.muted) {
        track.gain.gain.setTargetAtTime(track.volume, this.context.currentTime, track.levelSlew / 3);
      }
    } else if (oldMode === 'MUTE' || oldMode === 'SOLO') {
      // Unmute all tracks
      for (let i = 0; i < this.tracks.length; i++) {
        const other = this.tracks[i];
        if (other.gain && !other.muted) {
          other.gain.gain.setTargetAtTime(other.volume, this.context.currentTime, other.levelSlew / 3);
        }
      }
    }

    // Update source loop behavior for ONCE mode
    if (track.source) {
      if (mode === 'ONCE') {
        track.source.loop = false;
      } else if (oldMode === 'ONCE' && track.loop) {
        const clip = this.ensureClip(track);
        track.source.loop = true;
        if (track.loopEnd !== null) {
          track.source.loopStart = (track.loopStart / 16) * clip.duration;
          track.source.loopEnd = (track.loopEnd / 16) * clip.duration;
        }
      }
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
      if (track.loop && track.loopEnd !== null && track.mode !== 'ONCE') {
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
