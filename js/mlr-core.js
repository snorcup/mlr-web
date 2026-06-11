// mlr-core.js — faithful port of tehn/mlr v2.2.5
// 6 tracks, 16 clips, 4 views (REC/CUT/CLIP/TIME), 4 patterns, 4 recalls
// Bottom row: STOP ALL, mode buttons (CUT/SOLO/MUTE/ONCE), pattern play/record

import { InternalClock } from './midi.js';

export const TRACKS = 6;
export const CLIPS = 16;
export const GRID_ROWS = 8;
export const GRID_COLS = 16;
export const NAV_ROW = 0;
export const TRACK_ROW_START = 1; // y=1..6 are tracks
export const FN_ROW = 7; // bottom function row
export const PATTERN_COUNT = 4;
export const RECALL_COUNT = 4;
export const TIME_EPSILON = 0.000001;

// View IDs (match OG MLR constants)
export const vREC = 1;
export const vCUT = 2;
export const vCLIP = 3;
export const vTIME = 15;

// Track modes
export const mCUT = 0;
export const mSOLO = 1;
export const mMUTE = 2;
export const mONCE = 3;
export const MODE_NAMES = ['CUT', 'SOLO', 'MUTE', 'ONCE'];
export const MODE_LABELS = ['C', 'S', 'M', '1'];

// Event types
const eCUT = 1;
const eSTOP = 2;
const eSTART = 3;
const eLOOP = 4;
const eSPEED = 5;
const eREV = 6;
const ePATTERN = 7;

// Nav row button positions (x=0..15, y=0) — using 0-indexed x
const NAV_REC = 0;
const NAV_CUT = 1;
const NAV_CLIP = 2;
const NAV_STOP_ALL = 3;
const NAV_PAT_START = 4;  // x=4..7: Pattern 1-4 play
const NAV_REC_START = 8;  // x=8..11: Recall 1-4
const NAV_QUANT = 14;
const NAV_ALT = 15;

// Bottom function row (y=7) — 0-indexed x
const FN_VIEW_START = 0;   // x=0: CUT view, x=1: REC view, x=2: TIME view
const FN_STOP_ALL = 3;     // x=3: STOP ALL
const FN_MODE_START = 4;   // x=4: CUT mode, x=5: SOLO, x=6: MUTE, x=7: ONCE
const FN_PAT_PLAY = 8;     // x=8..11: Pattern 1-4 play
const FN_PAT_REC = 12;     // x=12..15: Pattern 1-4 record

// REC view track columns
const COL_REC = 0;
const COL_FOCUS_1 = 2;
const COL_FOCUS_2 = 3;
const COL_TEMPO = 4;
const COL_REV = 7;
const COL_SPEED_1 = 8;
const COL_STOP = 15;

function makeClip(i) {
  const CLIP_LEN_SEC = 4;
  return {
    name: '-',
    length: CLIP_LEN_SEC,
    bpm: 60 / CLIP_LEN_SEC,
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
    clip: i + 1,
    pos: 0,
    pos_grid: -1,
    speed: 0,
    rev: 0,
    tempo_map: 0,
    mode: mCUT, // per-track mode
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
    this.view = vCUT; // default to CUT view (main performance view)
    this.view_prev = vCUT;
    this.focus = 1;
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
    this.clip_action = 1;
    this.clip_sel = 1;

    // Speed mod per track
    this.speed_mod = Array.from({ length: TRACKS }, () => 0);

    // Pending mode assignment (for bottom row mode buttons)
    this.pendingMode = null; // null | mCUT | mSOLO | mMUTE | mONCE

    // Track which slice each track was last triggered at (for toggle)
    this.lastSlice = Array.from({ length: TRACKS }, () => -1);
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
    return this._quant_div / 4;
  }

  set quant_div(d) {
    this._quant_div = Math.max(1, Math.min(32, d | 0));
  }

  get quant_div() {
    return this._quant_div ?? 4;
  }

  tick(now) {
    if (this.quantize && this.clock.shouldTick(now)) {
      const q = this.quantize_events.splice(0);
      q.forEach(e => this.event_exec(e));
    }
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
      const track = this.tracks[i - 1];
      const clip = this.clips[track.clip - 1];
      if (!clip) return;
      if (track.loop === 1) {
        track.loop = 0;
        this.audio?.setLoop(i, 0);
      }
      this.audio?.jump(i, e.pos);
      if (track.play === 0) {
        track.play = 1;
        this.audio?.setPlay(i, 1);
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
      const pi = e.i - 1;
      if (e.action === 'stop') this.stopPatternPlayback(pi);
      else if (e.action === 'start') this.startPatternPlayback(pi);
      else if (e.action === 'rec_stop') this.stopPatternRecord(pi);
      else if (e.action === 'rec_start') this.startPatternRecord(pi);
      else if (e.action === 'clear') this.clearPattern(pi);
    }
  }

  // ─── Rate calculation ───

  updateRate(i) {
    const track = this.tracks[i - 1];
    let n = Math.pow(2, track.speed + this.speed_mod[i - 1]);
    if (track.rev === 1) n = -n;
    if (track.tempo_map === 1) {
      const clip = this.clips[track.clip - 1];
      const bpmmod = 120 / clip.bpm;
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

  // ─── STOP ALL ───

  stopAll() {
    for (let i = 1; i <= TRACKS; i++) {
      this.event({ t: eSTOP, i });
    }
    this.audio?.stopAll?.();
  }

  // ─── Per-track mode ───

  setTrackMode(trackIndex, mode) {
    this.tracks[trackIndex - 1].mode = mode;
    this.audio?.setMode?.(trackIndex, MODE_NAMES[mode]);
  }

  cycleTrackMode(trackIndex) {
    const track = this.tracks[trackIndex - 1];
    const next = (track.mode + 1) % 4;
    this.setTrackMode(trackIndex, next);
  }

  // ─── Grid key handler ───

  handleGridKey({ x, y, state }, now = 0) {
    const z = state ? 1 : 0;

    // Nav row
    if (y === NAV_ROW) {
      this.gridkeyNav(x, z, now);
      return;
    }

    // Track rows (y=1..6)
    if (y >= TRACK_ROW_START && y < TRACK_ROW_START + TRACKS) {
      const i = y; // track index (1-based)

      // If a mode is pending, apply it to this track
      if (this.pendingMode !== null && z === 1) {
        this.setTrackMode(i, this.pendingMode);
        this.pendingMode = null;
        this.render();
        return;
      }

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

    // Bottom function row (y=7)
    if (y === FN_ROW) {
      this.gridkeyFN(x, z, now);
    }
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
      } else if (x === NAV_STOP_ALL) {
        this.stopAll();
      } else if (x >= NAV_PAT_START && x < NAV_PAT_START + PATTERN_COUNT) {
        const pi = x - NAV_PAT_START;
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
        this.setView(-1);
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

  // ─── Bottom function row handler ───

  gridkeyFN(x, z, now) {
    if (z !== 1) {
      // Release: clear pending mode highlight
      if (x >= FN_MODE_START && x < FN_MODE_START + 4) {
        // mode button released
      }
      return;
    }

    // View buttons (x=0,1,2)
    if (x === 0) { this.setView(vCUT); return; }
    if (x === 1) { this.setView(vREC); return; }
    if (x === 2) { this.setView(vTIME); return; }

    // STOP ALL
    if (x === FN_STOP_ALL) {
      this.stopAll();
      return;
    }

    // Mode buttons (x=4..7) — set pending mode, apply on next track press
    if (x >= FN_MODE_START && x < FN_MODE_START + 4) {
      const mode = x - FN_MODE_START;
      if (this.pendingMode === mode) {
        // Press same mode again = cancel
        this.pendingMode = null;
      } else {
        this.pendingMode = mode;
      }
      this.render();
      return;
    }

    // Pattern play (x=8..11)
    if (x >= FN_PAT_PLAY && x < FN_PAT_PLAY + PATTERN_COUNT) {
      const pi = x - FN_PAT_PLAY;
      if (this.patterns[pi].recording) {
        this.stopPatternRecord(pi);
        this.startPatternPlayback(pi);
      } else if (this.patterns[pi].count === 0) {
        this.startPatternRecord(pi);
      } else if (this.patterns[pi].playing) {
        this.stopPatternPlayback(pi);
      } else {
        this.startPatternPlayback(pi);
      }
      this.render();
      return;
    }

    // Pattern record (x=12..15)
    if (x >= FN_PAT_REC && x < FN_PAT_REC + PATTERN_COUNT) {
      const pi = x - FN_PAT_REC;
      if (this.patterns[pi].recording) {
        this.stopPatternRecord(pi);
      } else {
        this.startPatternRecord(pi);
      }
      this.render();
      return;
    }
  }

  // ─── REC view grid handler ───

  gridkeyREC(x, y, z, i, now) {
    if (z !== 1) return;
    const track = this.tracks[i - 1];

    if (x === COL_FOCUS_1 || x === COL_FOCUS_2) {
      if (this.alt === 1) {
        track.tempo_map = 1 - track.tempo_map;
        this.updateRate(i);
      } else if (this.focus !== i) {
        this.focus = i;
      }
    } else if (x === COL_REC) {
      track.rec = 1 - track.rec;
      this.audio?.setRec(i, track.rec);
    } else if (x === COL_TEMPO) {
      if (this.alt === 1) {
        track.tempo_map = 1 - track.tempo_map;
        this.updateRate(i);
      }
    } else if (x === COL_REV) {
      const n = 1 - track.rev;
      this.event({ t: eREV, i, rev: n });
    } else if (x >= 8 && x <= 14) {
      const speed = x - 11;
      this.event({ t: eSPEED, i, speed });
    } else if (x === COL_STOP) {
      if (track.play === 1) {
        this.event({ t: eSTOP, i });
      } else {
        this.event({ t: eSTART, i });
      }
    }

    this.render();
  }

  // ─── CUT view grid handler ───
  // OG MLR: tap = loop from slice, tap same pad again = stop (toggle)
  // Two fingers = set loop region on release

  gridkeyCUT(x, y, z, i, now) {
    const row = y;

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

      if ((this.held[row] || 0) === 1) {
        this.first[row] = x;

        // Toggle: if pressing same slice that's already playing, stop
        const track = this.tracks[i - 1];
        if (track.play === 1 && this.lastSlice[i - 1] === x) {
          this.event({ t: eSTOP, i });
          this.lastSlice[i - 1] = -1;
        } else {
          this.event({ t: eCUT, i, pos: x });
          this.lastSlice[i - 1] = x;
        }
      } else if ((this.held[row] || 0) === 2) {
        this.second[row] = x;
      }
    } else if (z === 0) {
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
    if (x < 7 && y >= TRACK_ROW_START && y < TRACK_ROW_START + TRACKS) {
      this.clip_sel = i;
      this.setClip(i, x + 1);
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

    this.drawNav(f);
    this.drawFN(f);

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
    f[row][NAV_REC] = this.view === vREC ? 15 : 3;
    f[row][NAV_CUT] = this.view === vCUT ? 15 : 3;
    f[row][NAV_CLIP] = this.view === vCLIP ? 15 : 3;

    if (this.alt === 1) f[row][NAV_ALT] = 9;
    if (this.quantize === 1) f[row][NAV_QUANT] = 9;

    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = this.patterns[i];
      if (p.recording) f[row][NAV_PAT_START + i] = 15;
      else if (p.playing) f[row][NAV_PAT_START + i] = 9;
      else if (p.count > 0) f[row][NAV_PAT_START + i] = 5;
      else f[row][NAV_PAT_START + i] = 3;
    }

    for (let i = 0; i < RECALL_COUNT; i++) {
      const r = this.recalls[i];
      let b = 2;
      if (r.recording) b = 15;
      else if (r.active) b = 11;
      else if (r.has_data) b = 5;
      f[row][NAV_REC_START + i] = b;
    }
  }

  drawFN(f) {
    const row = FN_ROW;

    // View buttons mirror nav
    f[row][0] = this.view === vCUT ? 15 : 3;
    f[row][1] = this.view === vREC ? 15 : 3;
    f[row][2] = this.view === vTIME ? 15 : 3;

    // STOP ALL
    f[row][FN_STOP_ALL] = 6; // always visible as warning

    // Mode buttons
    for (let m = 0; m < 4; m++) {
      const col = FN_MODE_START + m;
      if (this.pendingMode === m) {
        f[row][col] = 15; // pending = bright
      } else {
        // Show if any track has this mode
        const hasMode = this.tracks.some(t => t.mode === m);
        f[row][col] = hasMode ? 7 : 2;
      }
    }

    // Pattern play buttons (x=8..11)
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = this.patterns[i];
      const col = FN_PAT_PLAY + i;
      if (p.recording) f[row][col] = 15;
      else if (p.playing) f[row][col] = 9;
      else if (p.count > 0) f[row][col] = 5;
      else f[row][col] = 2;
    }

    // Pattern record buttons (x=12..15)
    for (let i = 0; i < PATTERN_COUNT; i++) {
      const p = this.patterns[i];
      const col = FN_PAT_REC + i;
      if (p.recording) f[row][col] = 15;
      else f[row][col] = 2;
    }
  }

  drawREC(f) {
    f[COL_FOCUS_1][this.focus] = 7;
    f[COL_FOCUS_2][this.focus] = 7;

    for (let i = 0; i < TRACKS; i++) {
      const y = TRACK_ROW_START + i;
      const track = this.tracks[i];

      f[y][COL_REC] = 3;
      if (track.rec === 1) f[y][COL_REC] = 9;

      if (track.tempo_map === 1) f[y][COL_TEMPO] = 7;

      f[y][COL_REV] = 3;
      if (track.rev === 1) f[y][COL_REV] = 7;

      const speedCol = 11 + track.speed;
      if (speedCol >= 8 && speedCol <= 14) {
        f[y][speedCol] = 9;
      }
      f[y][11] = 3;

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
    for (let i = 0; i < CLIPS; i++) {
      f[TRACK_ROW_START + this.clip_sel - 1][i] = 4;
    }
    for (let i = 0; i < TRACKS; i++) {
      const clipIdx = this.tracks[i].clip - 1;
      if (clipIdx >= 0 && clipIdx < GRID_COLS) {
        f[TRACK_ROW_START + i][clipIdx] = 10;
      }
    }
  }

  drawTIME(f) {
    // TIME view: minimal grid
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
      pendingMode: this.pendingMode,
    };
  }
}

function roundTime(value) {
  return Math.round(value * 1000000) / 1000000;
}
