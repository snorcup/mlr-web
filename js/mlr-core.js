// mlr-core.js — faithful port of tehn/mlr v2.2.5
// 6 tracks, 16 clips, 4 views (REC/CUT/CLIP/TIME), 4 patterns, 4 recalls

import { InternalClock } from './midi.js';

export const TRACKS = 6;
export const CLIPS = 16;
export const GRID_ROWS = 8;
export const GRID_COLS = 16;
export const NAV_ROW = 0;
export const TRACK_ROW_START = 1; // y=1..6 are tracks
export const PATTERN_COUNT = 4;
export const RECALL_COUNT = 4;
export const TIME_EPSILON = 0.000001;

// View IDs (match OG MLR constants)
export const vREC = 1;
export const vCUT = 2;
export const vCLIP = 3;
export const vTIME = 15;

// Event types
const eCUT = 1;
const eSTOP = 2;
const eSTART = 3;
const eLOOP = 4;
const eSPEED = 5;
const eREV = 6;
const ePATTERN = 7;

// Nav row button positions (x=0..15, y=0)
const NAV_REC = 0;     // x=0: REC view
const NAV_CUT = 1;     // x=1: CUT view
const NAV_CLIP = 2;    // x=2: CLIP view
const NAV_STOP = 3;    // x=3: unused in OG (was STOP ALL)
const NAV_PAT_START = 4;  // x=4..7: Pattern 1-4
const NAV_REC_START = 8;  // x=8..11: Recall 1-4
const NAV_QUANT = 14;    // x=14: Quantize (alt=TIME)
const NAV_ALT = 15;      // x=15: Alt modifier

// REC view track columns
const COL_REC = 0;       // x=0: record arm
const COL_FOCUS_1 = 2;   // x=2: focus select
const COL_FOCUS_2 = 3;   // x=3: focus select
const COL_TEMPO = 4;     // x=4: tempo map
const COL_REV = 7;       // x=7: reverse
const COL_SPEED_1 = 8;   // x=8: speed=-4
// speed columns: x=8..15 map to speed -4..+3, center x=11 is speed=0 (1x)
const COL_STOP = 15;     // x=15: stop/start

function makeClip(i) {
  const CLIP_LEN_SEC = 4;
  return {
    name: '-',
    length: CLIP_LEN_SEC,
    bpm: 60 / CLIP_LEN_SEC, // 15 bpm for 4s clip
  };
}

function makeTrack(i) {
  return {
    head: (i - 1) % 4 + 1,
    play: 0,
    rec: 0,
    vol: 1,
    rec_level: 1,
    pre_level: 0,
    loop: 0,
    loop_start: 0,
    loop_end: 16,
    clip: i + 1, // each track starts pointing to its own clip (1-indexed)
    pos: 0,
    pos_grid: -1,
    speed: 0,    // speed value (-4..+3)
    rev: 0,      // 0=forward, 1=reverse
    tempo_map: 0, // 0=off, 1=on
  };
}

function makePattern() {
  return {
    events: [],
    count: 0,
    time: [],
    time_factor: 1,
    recording: false,
    playing: false,
    rec_start_time: 0,
    play_start_time: 0,
    last_cycle: 0,
    last_phase: 0,
  };
}

function makeRecall() {
  return {
    recording: false,
    has_data: false,
    active: false,
    event: [],
  };
}

export class MlrCore {
  constructor({ audio = null, onRender = () => {} } = {}) {
    this.audio = audio;
    this.onRender = onRender;
    this.clock = new InternalClock({ bpm: 120, subdivision: 4 });

    // State
    this.view = vREC;
    this.view_prev = vREC;
    this.focus = 1; // 1-indexed track focus (1..TRACKS)
    this.alt = 0;
    this.quantize = 0;

    // Clips
    this.clips = Array.from({ length: CLIPS }, (_, i) => makeClip(i));

    // Tracks
    this.tracks = Array.from({ length: TRACKS }, (_, i) => makeTrack(i));

    // Patterns
    this.patterns = Array.from({ length: PATTERN_COUNT }, () => makePattern());

    // Recalls
    this.recalls = Array.from({ length: RECALL_COUNT }, () => makeRecall());

    // Quantize event queue
    this.quantize_events = [];

    // Held-key tracking for CUT view (two-finger loop)
    this.held = Array.from({ length: GRID_ROWS }, () => 0);
    this.heldmax = Array.from({ length: GRID_ROWS }, () => 0);
    this.first = Array.from({ length: GRID_ROWS }, () => 0);
    this.second = Array.from({ length: GRID_ROWS }, () => 0);

    // CLIP view state
    this.clip_action = 1; // 1=load, 2=clear, 3=save
    this.clip_sel = 1;    // selected track for clip operations
    this.clip_clear_mult = 3;

    // Speed mod per track (encoder offset)
    this.speed_mod = Array.from({ length: TRACKS }, () => 0);
  }

  // ─── View management ───

  setView(v) {
    if (v === -1) v = this.view_prev;
    this.view_prev = this.view;
    this.view = v;
    this.render();
  }

  // ─── BPM / Quantize ───

  setBpm(bpm) {
    this.clock.setBpm(bpm);
  }

  get div() {
    // quant_div parameter, default 4 (1/16 notes at 4 ticks per beat)
    return this._quant_div / 4;
  }

  set quant_div(d) {
    this._quant_div = Math.max(1, Math.min(32, d | 0));
  }

  get quant_div() {
    return this._quant_div ?? 4;
  }

  tick(now) {
    // Quantize clock
    if (this.quantize && this.clock.shouldTick(now)) {
      const q = this.quantize_events.splice(0);
      q.forEach(e => this.event_exec(e));
    }
    // Pattern playback
    this.tickPatterns(now);
    this.render();
  }

  // ─── Event system ───

  event(e) {
    if (this.quantize) {
      this.event_q(e);
    } else {
      if (e.t !== ePATTERN) this.event_record(e);
      this.event_exec(e);
    }
  }

  event_q(e) {
    this.quantize_events.push(e);
  }

  event_record(e) {
    for (let i = 0; i < PATTERN_COUNT; i++) {
      this.patterns[i].events.push({ ...e });
      this.patterns[i].count = this.patterns[i].events.length;
    }
    for (let i = 0; i < RECALL_COUNT; i++) {
      if (this.recalls[i].recording) {
        this.recalls[i].event.push({ ...e });
        this.recalls[i].has_data = true;
      }
    }
  }

  event_exec(e) {
    const i = e.i; // 1-indexed track
    if (e.t === eCUT) {
      // Jump to slice position
      const track = this.tracks[i - 1];
      const clip = this.clips[track.clip - 1];
      if (!clip) return;
      // If looping, reset loop to full clip first
      if (track.loop === 1) {
        track.loop = 0;
        this.audio?.setLoop(i, 0);
      }
      const cut = (e.pos / 16) * clip.length;
      this.audio?.jump(i, e.pos);
      if (track.play === 0) {
        track.play = 1;
        this.audio?.setPlay(i, 1);
        // Lag: small delay before fading in level
        setTimeout(() => {
          this.audio?.setLevel(i, track.vol);
        }, 60);
      }
    } else if (e.t === eSTOP) {
      this.audio?.setLevel(i, 0);
      setTimeout(() => {
        this.tracks[i - 1].play = 0;
        this.tracks[i - 1].pos_grid = -1;
        this.audio?.setPlay(i, 0);
        this.render();
      }, 60);
    } else if (e.t === eSTART) {
      this.tracks[i - 1].play = 1;
      this.audio?.setPlay(i, 1);
      setTimeout(() => {
        this.audio?.setLevel(i, this.tracks[i - 1].vol);
        this.render();
      }, 60);
    } else if (e.t === eLOOP) {
      const track = this.tracks[i - 1];
      track.loop = 1;
      track.loop_start = e.loop_start;
      track.loop_end = e.loop_end;
      this.audio?.setLoop(i, 1, e.loop_start, e.loop_end);
    } else if (e.t === eSPEED) {
      this.tracks[i - 1].speed = e.speed;
      this.updateRate(i);
    } else if (e.t === eREV) {
      this.tracks[i - 1].rev = e.rev;
      this.updateRate(i);
    } else if (e.t === ePATTERN) {
      const pi = e.i - 1; // 0-indexed pattern
      if (e.action === 'stop') this.stopPatternPlayback(pi);
      else if (e.action === 'start') this.startPatternPlayback(pi);
      else if (e.action === 'rec_stop') this.stopPatternRecord(pi);
      else if (e.action === 'rec_start') this.startPatternRecord(pi);
      else if (e.action === 'clear') this.clearPattern(pi);
    }
  }

  // ─── Rate calculation (mirrors OG update_rate) ───

  updateRate(i) {
    const track = this.tracks[i - 1];
    let n = Math.pow(2, track.speed + this.speed_mod[i - 1]);
    if (track.rev === 1) n = -n;
    if (track.tempo_map === 1) {
      const clip = this.clips[track.clip - 1];
      const bpmmod = 120 / clip.bpm; // assumes clock_tempo=120
      n = n * bpmmod;
    }
    this.audio?.setRate(i, n);
  }

  // ─── Patterns ───

  startPatternRecord(slot) {
    const p = this.patterns[slot];
    p.events = [];
    p.count = 0;
    p.recording = true;
    p.playing = false;
    p.rec_start_time = this.audio?.context?.currentTime ?? 0;
    this.render();
  }

  stopPatternRecord(slot) {
    const p = this.patterns[slot];
    p.recording = false;
    p.time = p.events.map(e => e.time);
    p.time_factor = 1;
    this.render();
  }

  startPatternPlayback(slot) {
    const p = this.patterns[slot];
    if (!p.events.length) return false;
    p.playing = true;
    p.play_start_time = this.audio?.context?.currentTime ?? 0;
    p.last_cycle = 0;
    p.last_phase = 0;
    this.render();
    return true;
  }

  stopPatternPlayback(slot) {
    this.patterns[slot].playing = false;
    this.render();
  }

  clearPattern(slot) {
    const p = this.patterns[slot];
    p.events = [];
    p.count = 0;
    p.time = [];
    p.recording = false;
    p.playing = false;
    this.render();
  }

  tickPatterns(now) {
    for (const p of this.patterns) {
      if (!p.playing || !p.events.length) continue;
      const elapsed = Math.max(0, now - p.play_start_time);
      const cycle = Math.floor(elapsed / Math.max(0.25, p.time_factor));
      const phase = roundTime(elapsed % Math.max(0.25, p.time_factor));
      const due = cycle > p.last_cycle
        ? p.events.filter(e => e.time > p.last_phase + TIME_EPSILON || e.time <= phase + TIME_EPSILON)
        : p.events.filter(e => e.time > p.last_phase + TIME_EPSILON && e.time <= phase + TIME_EPSILON);
      due.sort((a, b) => a.time - b.time).forEach(e => this.event_exec(e));
      p.last_cycle = cycle;
      p.last_phase = phase;
    }
  }

  // ─── Grid key handler ───

  handleGridKey({ x, y, state }, now = 0) {
    // Normalize: UI sends boolean true/false, OG uses 1/0
    const z = state ? 1 : 0;

    // Nav row
    if (y === NAV_ROW) {
      this.gridkeyNav(x, z, now);
      return;
    }

    // Track rows (y=1..6)
    if (y >= TRACK_ROW_START && y < TRACK_ROW_START + TRACKS) {
      const i = y; // track index (1-based, since y=1 -> track 1)
      if (this.view === vREC) {
        this.gridkeyREC(x, y, z, i, now);
      } else if (this.view === vCUT) {
        this.gridkeyCUT(x, y, z, i, now);
      } else if (this.view === vCLIP) {
        this.gridkeyCLIP(x, y, z, i);
      } else if (this.view === vTIME) {
        // TIME view: no track row actions
      }
    }

    // Row 7 (y=7) is unused in OG
  }

  // ─── Nav row handler ───

  gridkeyNav(x, z, now) {
    if (z === 1) {
      if (x === NAV_REC) {
        if (this.alt === 1) {
          this.audio?.clearBuffer?.();
        }
        this.setView(vREC);
      } else if (x === NAV_CUT) {
        this.setView(vCUT);
      } else if (x === NAV_CLIP) {
        this.setView(vCLIP);
      } else if (x >= NAV_PAT_START && x < NAV_PAT_START + PATTERN_COUNT) {
        const pi = x - NAV_PAT_START; // 0-indexed
        if (this.alt === 1) {
          this.clearPattern(pi);
        } else if (this.patterns[pi].recording) {
          this.stopPatternRecord(pi);
          this.startPatternPlayback(pi);
        } else if (this.patterns[pi].count === 0) {
          this.startPatternRecord(pi);
        } else if (this.patterns[pi].playing) {
          this.stopPatternPlayback(pi);
        } else {
          this.startPatternPlayback(pi);
        }
      } else if (x >= NAV_REC_START && x < NAV_REC_START + RECALL_COUNT) {
        const ri = x - NAV_REC_START;
        if (this.alt === 1) {
          this.recalls[ri].event = [];
          this.recalls[ri].recording = false;
          this.recalls[ri].has_data = false;
          this.recalls[ri].active = false;
        } else if (this.recalls[ri].recording) {
          this.recalls[ri].recording = false;
        } else if (!this.recalls[ri].has_data) {
          this.recalls[ri].recording = true;
        } else if (this.recalls[ri].has_data) {
          this.recallExec(ri);
          this.recalls[ri].active = true;
        }
      } else if (x === NAV_QUANT && this.alt === 0) {
        this.quantize = 1 - this.quantize;
      } else if (x === NAV_QUANT && this.alt === 1) {
        this.setView(vTIME);
      } else if (x === NAV_ALT) {
        this.alt = 1;
      }
    } else if (z === 0) {
      if (x === NAV_ALT) {
        this.alt = 0;
      } else if (x === NAV_QUANT && this.view === vTIME) {
        this.setView(-1); // return to previous view
      } else if (x >= NAV_REC_START && x < NAV_REC_START + RECALL_COUNT) {
        this.recalls[x - NAV_REC_START].active = false;
      }
    }
    this.render();
  }

  recallExec(ri) {
    for (const e of this.recalls[ri].event) {
      this.event_exec(e);
    }
  }

  // ─── REC view grid handler ───

  gridkeyREC(x, y, z, i, now) {
    if (z !== 1) return;
    const track = this.tracks[i - 1];

    // Focus select (x=2,3)
    if (x === COL_FOCUS_1 || x === COL_FOCUS_2) {
      if (this.alt === 1) {
        track.tempo_map = 1 - track.tempo_map;
        this.updateRate(i);
      } else if (this.focus !== i) {
        this.focus = i;
      }
    }
    // Record arm (x=0)
    else if (x === COL_REC) {
      track.rec = 1 - track.rec;
      this.audio?.setRec(i, track.rec);
    }
    // Tempo map (x=4)
    else if (x === COL_TEMPO) {
      if (this.alt === 1) {
        track.tempo_map = 1 - track.tempo_map;
        this.updateRate(i);
      }
    }
    // Reverse (x=7)
    else if (x === COL_REV) {
      const n = 1 - track.rev;
      this.event({ t: eREV, i, rev: n });
    }
    // Speed (x=8..14 0-indexed, maps to speed -3..+3)
    // OG: x=9..15 (1-indexed), speed = x-12
    else if (x >= 8 && x <= 14) {
      const speed = x - 11; // x=8→-3, x=11→0, x=14→+3
      this.event({ t: eSPEED, i, speed });
    }
    // Stop/Start (x=15)
    else if (x === COL_STOP) {
      if (track.play === 1) {
        this.event({ t: eSTOP, i });
      } else {
        this.event({ t: eSTART, i });
      }
    }

    this.render();
  }

  // ─── CUT view grid handler ───

  gridkeyCUT(x, y, z, i, now) {
    const row = y; // use row index for held tracking

    if (z === 1) {
      this.held[row] = (this.held[row] || 0) + 1;
      if (this.held[row] > (this.heldmax[row] || 0)) this.heldmax[row] = this.held[row];
    } else {
      this.held[row] = Math.max(0, (this.held[row] || 0) - 1);
    }

    if (z === 1) {
      if (this.focus !== i) {
        this.focus = i;
      }

      if (this.alt === 1) {
        // Alt+press = start/stop toggle
        if (this.tracks[i - 1].play === 1) {
          this.event({ t: eSTOP, i });
        } else {
          this.event({ t: eSTART, i });
        }
      } else if ((this.held[row] || 0) === 1) {
        // First finger: jump to slice
        this.first[row] = x;
        const cut = x; // 0-indexed column = slice position
        this.event({ t: eCUT, i, pos: cut });
      } else if ((this.held[row] || 0) === 2) {
        // Second finger: prepare for loop
        this.second[row] = x;
      }
    } else if (z === 0) {
      // On release: if we had two fingers, set loop
      if ((this.held[row] || 0) === 1 && this.heldmax[row] === 2) {
        const ls = Math.min(this.first[row], this.second[row]);
        const le = Math.max(this.first[row], this.second[row]);
        this.event({ t: eLOOP, i, loop: 1, loop_start: ls, loop_end: le });
      }
      this.heldmax[row] = 0;
    }

    this.render();
  }

  // ─── CLIP view grid handler ───

  gridkeyCLIP(x, y, z, i) {
    if (z !== 1) return;
    // x=0..6 (7 clip slots), y=1..6 (tracks)
    if (x < 7 && y >= TRACK_ROW_START && y < TRACK_ROW_START + TRACKS) {
      this.clip_sel = i;
      this.setClip(i, x + 1); // clips are 1-indexed
    }
    this.render();
  }

  setClip(trackIndex, clipIndex) {
    const t = this.tracks[trackIndex - 1];
    t.clip = clipIndex;
    this.audio?.assignClip(trackIndex, clipIndex);
  }

  // ─── Framebuffer generation ───

  framebuffer() {
    const f = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(0));

    // Always draw nav row
    this.drawNav(f);

    if (this.view === vREC) {
      this.drawREC(f);
    } else if (this.view === vCUT) {
      this.drawCUT(f);
    } else if (this.view === vCLIP) {
      this.drawCLIP(f);
    } else if (this.view === vTIME) {
      this.drawTIME(f);
    }

    return f;
  }

  drawNav(f) {
    const row = NAV_ROW;
    // View buttons
    f[row][NAV_REC] = this.view === vREC ? 15 : 3;
    f[row][NAV_CUT] = this.view === vCUT ? 15 : 3;
    f[row][NAV_CLIP] = this.view === vCLIP ? 15 : 3;

    // Alt indicator
    if (this.alt === 1) f[row][NAV_ALT] = 9;

    // Quantize
    if (this.quantize === 1) f[row][NAV_QUANT] = 9;

    // Patterns
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = this.patterns[i];
      if (p.recording) f[row][NAV_PAT_START + i] = 15;
      else if (p.playing) f[row][NAV_PAT_START + i] = 9;
      else if (p.count > 0) f[row][NAV_PAT_START + i] = 5;
      else f[row][NAV_PAT_START + i] = 3;
    }

    // Recalls
    for (let i = 0; i < RECALL_COUNT; i++) {
      const r = this.recalls[i];
      let b = 2;
      if (r.recording) b = 15;
      else if (r.active) b = 11;
      else if (r.has_data) b = 5;
      f[row][NAV_REC_START + i] = b;
    }
  }

  drawREC(f) {
    // Focus indicator
    f[COL_FOCUS_1][this.focus] = 7;
    f[COL_FOCUS_2][this.focus] = 7;

    for (let i = 0; i < TRACKS; i++) {
      const y = TRACK_ROW_START + i;
      const track = this.tracks[i];

      // Rec arm
      f[y][COL_REC] = 3;
      if (track.rec === 1) f[y][COL_REC] = 9;

      // Tempo map
      if (track.tempo_map === 1) f[y][COL_TEMPO] = 7;

      // Reverse
      f[y][COL_REV] = 3;
      if (track.rev === 1) f[y][COL_REV] = 7;

      // Speed indicator: OG x=12 (1-indexed) = x=11 (0-indexed) for speed=0 (1x)
      // Speed range: -3..+3, mapped to x=9..15 (1-indexed) = x=8..14 (0-indexed)
      // x=8 (0-indexed) = reverse button, x=15 = stop/start
      const speedCol = 11 + track.speed; // speed 0 -> x=11, speed -3 -> x=8, speed +3 -> x=14
      if (speedCol >= 8 && speedCol <= 14) {
        f[y][speedCol] = 9;
      }
      f[y][11] = 3; // speed=0 (1x) center marker

      // Stop/Start
      f[y][COL_STOP] = 3;
      if (track.play === 1) f[y][COL_STOP] = 15;
    }
  }

  drawCUT(f) {
    for (let i = 0; i < TRACKS; i++) {
      const y = TRACK_ROW_START + i;
      const track = this.tracks[i];

      // Loop region
      if (track.loop === 1) {
        for (let x = track.loop_start; x <= track.loop_end && x < GRID_COLS; x++) {
          f[y][x] = 4;
        }
      }

      // Playhead
      if (track.play === 1) {
        const pos = this.audio?.positionSlice(i + 1) ?? track.pos_grid;
        if (pos >= 0 && pos < GRID_COLS) {
          f[y][pos] = 15;
        }
      }
    }
  }

  drawCLIP(f) {
    // Highlight clip selection for selected track
    for (let i = 0; i < CLIPS; i++) {
      f[TRACK_ROW_START + this.clip_sel - 1][i] = 4;
    }
    // Show current clip assignment per track
    for (let i = 0; i < TRACKS; i++) {
      const clipIdx = this.tracks[i].clip - 1;
      if (clipIdx >= 0 && clipIdx < GRID_COLS) {
        f[TRACK_ROW_START + i][clipIdx] = 10;
      }
    }
  }

  drawTIME(f) {
    // TIME view: minimal grid, just nav row
    // (tempo/quantize controlled via encoders in OG)
  }

  render() {
    this.onRender(this.framebuffer(), this.state);
  }

  get state() {
    return {
      view: this.view,
      view_prev: this.view_prev,
      focus: this.focus,
      alt: this.alt,
      quantize: this.quantize,
      tracks: this.tracks,
      clips: this.clips,
      patterns: this.patterns,
      recalls: this.recalls,
      clip_action: this.clip_action,
      clip_sel: this.clip_sel,
    };
  }
}

function roundTime(value) {
  return Math.round(value * 1000000) / 1000000;
}
