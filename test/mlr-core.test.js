// test/mlr-core.test.js — tests for OG-faithful web-mlr
import test from 'node:test';
import assert from 'node:assert/strict';
import { MlrCore, TRACKS, CLIPS, GRID_ROWS, GRID_COLS, vREC, vCUT, vCLIP, vTIME } from '../js/mlr-core.js';
import { parseMonomePackets } from '../js/monome.js';

// ─── Constants match OG MLR ───

test('TRACKS is 6 (not 7)', () => {
  assert.equal(TRACKS, 6);
});

test('CLIPS is 16', () => {
  assert.equal(CLIPS, 16);
});

test('grid is 8×16', () => {
  assert.equal(GRID_ROWS, 8);
  assert.equal(GRID_COLS, 16);
});

test('default view is REC', () => {
  const core = new MlrCore({ audio: null });
  assert.equal(core.view, vREC);
});

test('focus starts at track 1', () => {
  const core = new MlrCore({ audio: null });
  assert.equal(core.focus, 1);
});

// ─── View switching ───

test('setView changes view and preserves previous', () => {
  const core = new MlrCore({ audio: null });
  core.setView(vCUT);
  assert.equal(core.view, vCUT);
  assert.equal(core.view_prev, vREC);
  core.setView(vCLIP);
  assert.equal(core.view, vCLIP);
  assert.equal(core.view_prev, vCUT);
});

test('setView(-1) returns to previous view', () => {
  const core = new MlrCore({ audio: null });
  core.setView(vCUT);
  core.setView(-1);
  assert.equal(core.view, vREC);
});

// ─── Track state ───

test('each track starts with its own clip (1-indexed)', () => {
  const core = new MlrCore({ audio: null });
  for (let i = 0; i < TRACKS; i++) {
    assert.equal(core.tracks[i].clip, i + 1);
  }
});

test('all clips initialized with default length', () => {
  const core = new MlrCore({ audio: null });
  for (let i = 0; i < CLIPS; i++) {
    assert.equal(core.clips[i].length, 4);
    assert.equal(core.clips[i].name, '-');
  }
});

// ─── REC view grid key handling ───

test('REC view: focus select sets focus', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  core.handleGridKey({ x: 2, y: 3, state: true });
  assert.equal(core.focus, 3);
});

test('REC view: record arm toggle', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1, setRec: () => {} } });
  assert.equal(core.tracks[0].rec, 0);
  core.handleGridKey({ x: 0, y: 1, state: true });
  assert.equal(core.tracks[0].rec, 1);
  core.handleGridKey({ x: 0, y: 1, state: true });
  assert.equal(core.tracks[0].rec, 0);
});

test('REC view: reverse toggle', () => {
  const audio = { jump: () => {}, positionSlice: () => -1, setRate: () => {}, setPlay: () => {}, setLevel: () => {} };
  const core = new MlrCore({ audio });
  assert.equal(core.tracks[0].rev, 0);
  core.handleGridKey({ x: 7, y: 1, state: true });
  assert.equal(core.tracks[0].rev, 1);
});

test('REC view: speed sets correct value', () => {
  const audio = { jump: () => {}, positionSlice: () => -1, setRate: () => {}, setPlay: () => {}, setLevel: () => {} };
  const core = new MlrCore({ audio });
  // x=8 (0-indexed) → speed = 8-11 = -3
  core.handleGridKey({ x: 8, y: 1, state: true });
  assert.equal(core.tracks[0].speed, -3);
  // x=11 → speed = 0 (1x)
  core.handleGridKey({ x: 11, y: 1, state: true });
  assert.equal(core.tracks[0].speed, 0);
  // x=14 → speed = +3
  core.handleGridKey({ x: 14, y: 1, state: true });
  assert.equal(core.tracks[0].speed, +3);
});

test('REC view: stop/start toggle', () => {
  const calls = [];
  const audio = {
    positionSlice: () => -1,
    setPlay: (i, p) => calls.push(['setPlay', i, p]),
    setLevel: (i, l) => calls.push(['setLevel', i, l]),
    setRate: () => {},
  };
  const core = new MlrCore({ audio });
  // Start
  core.handleGridKey({ x: 15, y: 1, state: true });
  assert.ok(calls.some(c => c[0] === 'setPlay' && c[2] === 1));
  // Stop
  calls.length = 0;
  core.tracks[0].play = 1; // mark as playing
  core.handleGridKey({ x: 15, y: 1, state: true });
  // Stop event queues a delayed action; setLevel(0) fires immediately
  assert.ok(calls.some(c => c[0] === 'setLevel' && c[2] === 0));
});

test('REC view: alt+toggle tempo map', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1, setRate: () => {} } });
  core.alt = 1;
  assert.equal(core.tracks[0].tempo_map, 0);
  core.handleGridKey({ x: 2, y: 1, state: true });
  assert.equal(core.tracks[0].tempo_map, 1);
});

// ─── CUT view ───

test('CUT view: single press jumps to slice', () => {
  const calls = [];
  const audio = { jump: (i, s) => calls.push({ track: i, slice: s }), positionSlice: () => -1, setPlay: () => {}, setLevel: () => {}, setLoop: () => {} };
  const core = new MlrCore({ audio });
  core.setView(vCUT);
  core.handleGridKey({ x: 5, y: 2, state: true });
  assert.deepEqual(calls, [{ track: 2, slice: 5 }]);
});

test('CUT view: sets focus on press', () => {
  const core = new MlrCore({ audio: { jump: () => {}, positionSlice: () => -1, setPlay: () => {}, setLevel: () => {}, setLoop: () => {} } });
  core.setView(vCUT);
  core.handleGridKey({ x: 3, y: 4, state: true });
  assert.equal(core.focus, 4);
});

// ─── Nav row ───

test('nav: x=0 switches to REC view', () => {
  const core = new MlrCore({ audio: null });
  core.setView(vCUT);
  core.handleGridKey({ x: 0, y: 0, state: true });
  assert.equal(core.view, vREC);
});

test('nav: x=1 switches to CUT view', () => {
  const core = new MlrCore({ audio: null });
  core.handleGridKey({ x: 1, y: 0, state: true });
  assert.equal(core.view, vCUT);
});

test('nav: x=2 switches to CLIP view', () => {
  const core = new MlrCore({ audio: null });
  core.handleGridKey({ x: 2, y: 0, state: true });
  assert.equal(core.view, vCLIP);
});

test('nav: x=14 toggles quantize', () => {
  const core = new MlrCore({ audio: null });
  assert.equal(core.quantize, 0);
  core.handleGridKey({ x: 14, y: 0, state: true });
  assert.equal(core.quantize, 1);
  core.handleGridKey({ x: 14, y: 0, state: true });
  assert.equal(core.quantize, 0);
});

test('nav: x=14+alt switches to TIME view', () => {
  const core = new MlrCore({ audio: null });
  core.alt = 1;
  core.handleGridKey({ x: 14, y: 0, state: true });
  assert.equal(core.view, vTIME);
});

test('nav: x=15 toggles alt modifier', () => {
  const core = new MlrCore({ audio: null });
  core.handleGridKey({ x: 15, y: 0, state: true });
  assert.equal(core.alt, 1);
  core.handleGridKey({ x: 15, y: 0, state: false });
  assert.equal(core.alt, 0);
});

test('nav: pattern buttons cycle rec→play→stop', () => {
  const core = new MlrCore({ audio: null });
  // Empty pattern → press → start recording
  assert.equal(core.patterns[0].recording, false);
  core.handleGridKey({ x: 4, y: 0, state: true }); // P1
  assert.equal(core.patterns[0].recording, true);
  // Record an event so playback has something to play
  core.patterns[0].events.push({ t: 1, i: 1, pos: 0, time: 0 });
  core.patterns[0].count = 1;
  // Press again → stop record, start playback
  core.handleGridKey({ x: 4, y: 0, state: true });
  assert.equal(core.patterns[0].recording, false);
  assert.equal(core.patterns[0].playing, true);
  // Press again → stop playback
  core.handleGridKey({ x: 4, y: 0, state: true });
  assert.equal(core.patterns[0].playing, false);
});

test('nav: alt+pattern clears pattern', () => {
  const core = new MlrCore({ audio: null });
  core.startPatternRecord(0);
  core.stopPatternRecord(0);
  assert.equal(core.patterns[0].events.length, 0);
});

// ─── Framebuffer ───

test('framebuffer has correct dimensions', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  assert.equal(frame.length, 8);
  assert.equal(frame[0].length, 16);
});

test('REC view: nav row shows REC view active', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  // x=0 (REC) should be bright, x=1 (CUT) and x=2 (CLIP) dim
  assert.ok(frame[0][0] >= 12, 'REC nav LED should be bright');
  assert.ok(frame[0][1] < 12, 'CUT nav LED should be dim');
  assert.ok(frame[0][2] < 12, 'CLIP nav LED should be dim');
});

test('CUT view: nav row shows CUT view active', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  core.setView(vCUT);
  const frame = core.framebuffer();
  assert.ok(frame[0][1] >= 12, 'CUT nav LED should be bright');
  assert.ok(frame[0][0] < 12, 'REC nav LED should be dim');
});

// ─── Monome parser ───

test('monome parser extracts key packets', () => {
  assert.deepEqual(parseMonomePackets([0x21, 2, 3, 0x20, 2, 3]), [
    { x: 2, y: 3, state: true },
    { x: 2, y: 3, state: false },
  ]);
});

test('monome parser preserves 16-column coordinates', () => {
  assert.deepEqual(parseMonomePackets([0x21, 15, 6]), [{ x: 15, y: 6, state: true }]);
});

// ─── Rate calculation ───

test('updateRate: speed 0 = 1x rate', () => {
  const rates = [];
  const audio = { setRate: (i, r) => rates.push(r) };
  const core = new MlrCore({ audio });
  core.tracks[0].speed = 0;
  core.tracks[0].rev = 0;
  core.tracks[0].tempo_map = 0;
  core.speed_mod[0] = 0;
  core.updateRate(1);
  assert.deepEqual(rates, [1]);
});

test('updateRate: speed +1 = 2x rate', () => {
  const rates = [];
  const audio = { setRate: (i, r) => rates.push(r) };
  const core = new MlrCore({ audio });
  core.tracks[0].speed = 1;
  core.tracks[0].rev = 0;
  core.tracks[0].tempo_map = 0;
  core.speed_mod[0] = 0;
  core.updateRate(1);
  assert.deepEqual(rates, [2]);
});

test('updateRate: reverse flips sign', () => {
  const rates = [];
  const audio = { setRate: (i, r) => rates.push(r) };
  const core = new MlrCore({ audio });
  core.tracks[0].speed = 0;
  core.tracks[0].rev = 1;
  core.tracks[0].tempo_map = 0;
  core.speed_mod[0] = 0;
  core.updateRate(1);
  assert.deepEqual(rates, [-1]);
});

// ─── Quantize ───

test('quantized events queue until clock tick', () => {
  const calls = [];
  const core = new MlrCore({
    audio: { jump: (track, slice) => calls.push({ track, slice }), positionSlice: () => -1, setPlay: () => {}, setLevel: () => {}, setLoop: () => {} },
  });
  core.setView(vCUT);
  core.quantize = 1;
  core.handleGridKey({ x: 3, y: 2, state: true });
  assert.equal(calls.length, 0, 'events should be queued');
  core.clock.nextTime = 0;
  core.tick(1);
  assert.deepEqual(calls, [{ track: 2, slice: 3 }], 'events should execute on tick');
});
