// test/mlr-core.test.js — tests for OG-faithful web-mlr
import test from 'node:test';
import assert from 'node:assert/strict';
import { MlrCore, TRACKS, CLIPS, GRID_ROWS, GRID_COLS, vREC, vCUT, vCLIP, vTIME, mCUT, mSOLO, mMUTE, mONCE } from '../js/mlr-core.js';
import { parseMonomePackets } from '../js/monome.js';

// ─── Constants match OG MLR ───

test('TRACKS is 6', () => {
  assert.equal(TRACKS, 6);
});

test('CLIPS is 16', () => {
  assert.equal(CLIPS, 16);
});

test('grid is 8×16', () => {
  assert.equal(GRID_ROWS, 8);
  assert.equal(GRID_COLS, 16);
});

test('default view is CUT', () => {
  const core = new MlrCore({ audio: null });
  assert.equal(core.view, vCUT);
});

test('focus starts at track 1', () => {
  const core = new MlrCore({ audio: null });
  assert.equal(core.focus, 1);
});

// ─── Track modes ───

test('all tracks start in CUT mode', () => {
  const core = new MlrCore({ audio: null });
  for (let i = 0; i < TRACKS; i++) {
    assert.equal(core.tracks[i].mode, mCUT);
  }
});

test('setTrackMode changes mode', () => {
  const core = new MlrCore({ audio: { setMode: () => {} } });
  core.setTrackMode(1, mSOLO);
  assert.equal(core.tracks[0].mode, mSOLO);
  core.setTrackMode(1, mMUTE);
  assert.equal(core.tracks[0].mode, mMUTE);
  core.setTrackMode(1, mONCE);
  assert.equal(core.tracks[0].mode, mONCE);
});

test('cycleTrackMode cycles through modes', () => {
  const core = new MlrCore({ audio: { setMode: () => {} } });
  assert.equal(core.tracks[0].mode, mCUT);
  core.cycleTrackMode(1);
  assert.equal(core.tracks[0].mode, mSOLO);
  core.cycleTrackMode(1);
  assert.equal(core.tracks[0].mode, mMUTE);
  core.cycleTrackMode(1);
  assert.equal(core.tracks[0].mode, mONCE);
  core.cycleTrackMode(1);
  assert.equal(core.tracks[0].mode, mCUT);
});

// ─── Pending mode ───

test('bottom row mode button sets pending mode', () => {
  const core = new MlrCore({ audio: null });
  assert.equal(core.pendingMode, null);
  core.gridkeyFN(4, 1); // press SOLO mode button (x=4 = mCUT, x=5 = mSOLO)
  assert.equal(core.pendingMode, mCUT);
  core.gridkeyFN(5, 1); // press SOLO
  assert.equal(core.pendingMode, mSOLO);
});

test('pending mode applies to track on track press', () => {
  const core = new MlrCore({ audio: { setMode: () => {} } });
  core.pendingMode = mSOLO;
  core.handleGridKey({ x: 3, y: 2, state: true });
  assert.equal(core.tracks[1].mode, mSOLO);
  assert.equal(core.pendingMode, null);
});

test('pressing same mode button cancels pending', () => {
  const core = new MlrCore({ audio: null });
  core.gridkeyFN(5, 1); // press SOLO
  assert.equal(core.pendingMode, mSOLO);
  core.gridkeyFN(5, 1); // press SOLO again
  assert.equal(core.pendingMode, null);
});

// ─── STOP ALL ───

test('stopAll sends STOP to all tracks', () => {
  const calls = [];
  const audio = {
    stopAll: () => calls.push('stopAll'),
    setLevel: () => {},
    setPlay: () => {},
    positionSlice: () => -1,
  };
  const core = new MlrCore({ audio });
  // Mark some tracks as playing
  core.tracks[0].play = 1;
  core.tracks[2].play = 1;
  core.tracks[4].play = 1;
  core.stopAll();
  assert.ok(calls.includes('stopAll'));
});

test('bottom row STOP ALL button works', () => {
  const calls = [];
  const audio = {
    stopAll: () => calls.push('stopAll'),
    setLevel: () => {},
    setPlay: () => {},
  };
  const core = new MlrCore({ audio });
  core.gridkeyFN(3, 1); // x=3 = STOP ALL
  assert.ok(calls.includes('stopAll'));
});

// ─── View switching ───

test('setView changes view and preserves previous', () => {
  const core = new MlrCore({ audio: null });
  core.setView(vREC);
  assert.equal(core.view, vREC);
  assert.equal(core.view_prev, vCUT);
  core.setView(vCLIP);
  assert.equal(core.view, vCLIP);
  assert.equal(core.view_prev, vREC);
});

test('setView(-1) returns to previous view', () => {
  const core = new MlrCore({ audio: null });
  core.setView(vREC);
  core.setView(-1);
  assert.equal(core.view, vCUT);
});

test('bottom row view buttons work', () => {
  const core = new MlrCore({ audio: null });
  core.gridkeyFN(1, 1); // x=1 = REC
  assert.equal(core.view, vREC);
  core.gridkeyFN(0, 1); // x=0 = CUT
  assert.equal(core.view, vCUT);
  core.gridkeyFN(2, 1); // x=2 = TIME
  assert.equal(core.view, vTIME);
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
  core.setView(vREC);
  core.handleGridKey({ x: 2, y: 3, state: true });
  assert.equal(core.focus, 3);
});

test('REC view: record arm toggle', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1, setRec: () => {} } });
  core.setView(vREC);
  assert.equal(core.tracks[0].rec, 0);
  core.handleGridKey({ x: 0, y: 1, state: true });
  assert.equal(core.tracks[0].rec, 1);
  core.handleGridKey({ x: 0, y: 1, state: true });
  assert.equal(core.tracks[0].rec, 0);
});

test('REC view: reverse toggle', () => {
  const audio = { jump: () => {}, positionSlice: () => -1, setRate: () => {}, setPlay: () => {}, setLevel: () => {} };
  const core = new MlrCore({ audio });
  core.setView(vREC);
  assert.equal(core.tracks[0].rev, 0);
  core.handleGridKey({ x: 7, y: 1, state: true });
  assert.equal(core.tracks[0].rev, 1);
});

test('REC view: speed sets correct value', () => {
  const audio = { jump: () => {}, positionSlice: () => -1, setRate: () => {}, setPlay: () => {}, setLevel: () => {} };
  const core = new MlrCore({ audio });
  core.setView(vREC);
  core.handleGridKey({ x: 8, y: 1, state: true });
  assert.equal(core.tracks[0].speed, -3);
  core.handleGridKey({ x: 11, y: 1, state: true });
  assert.equal(core.tracks[0].speed, 0);
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
  core.setView(vREC);
  core.handleGridKey({ x: 15, y: 1, state: true });
  assert.ok(calls.some(c => c[0] === 'setPlay' && c[2] === 1));
  calls.length = 0;
  core.tracks[0].play = 1;
  core.handleGridKey({ x: 15, y: 1, state: true });
  assert.ok(calls.some(c => c[0] === 'setLevel' && c[2] === 0));
});

// ─── CUT view ───

test('CUT view: single press jumps to slice', () => {
  const calls = [];
  const audio = { jump: (i, s) => calls.push({ track: i, slice: s }), positionSlice: () => -1, setPlay: () => {}, setLevel: () => {}, setLoop: () => {} };
  const core = new MlrCore({ audio });
  core.handleGridKey({ x: 5, y: 2, state: true });
  assert.deepEqual(calls, [{ track: 2, slice: 5 }]);
});

test('CUT view: pressing same slice toggles off', () => {
  const calls = [];
  const audio = {
    jump: (i, s) => calls.push(['jump', i, s]),
    setLevel: (i, l) => calls.push(['setLevel', i, l]),
    setPlay: (i, p) => calls.push(['setPlay', i, p]),
    positionSlice: () => -1,
    setLoop: () => {},
  };
  const core = new MlrCore({ audio });
  // First press: start playing
  core.handleGridKey({ x: 5, y: 2, state: true });
  core.handleGridKey({ x: 5, y: 2, state: false }); // release
  assert.ok(calls.some(c => c[0] === 'jump' && c[1] === 2 && c[2] === 5));
  // Mark as playing
  core.tracks[1].play = 1;
  calls.length = 0;
  // Second press on same slice: should stop
  core.handleGridKey({ x: 5, y: 2, state: true });
  assert.ok(calls.some(c => c[0] === 'setLevel' && c[1] === 2 && c[2] === 0));
});

test('CUT view: sets focus on press', () => {
  const core = new MlrCore({ audio: { jump: () => {}, positionSlice: () => -1, setPlay: () => {}, setLevel: () => {}, setLoop: () => {} } });
  core.handleGridKey({ x: 3, y: 4, state: true });
  assert.equal(core.focus, 4);
});

// ─── Nav row ───

test('nav: x=1 switches to CUT view', () => {
  const core = new MlrCore({ audio: null });
  core.setView(vREC);
  core.handleGridKey({ x: 1, y: 0, state: true });
  assert.equal(core.view, vCUT);
});

test('nav: x=0 switches to REC view', () => {
  const core = new MlrCore({ audio: null });
  core.handleGridKey({ x: 0, y: 0, state: true });
  assert.equal(core.view, vREC);
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
  assert.equal(core.patterns[0].recording, false);
  core.handleGridKey({ x: 4, y: 0, state: true });
  assert.equal(core.patterns[0].recording, true);
  core.patterns[0].events.push({ t: 1, i: 1, pos: 0, time: 0 });
  core.patterns[0].count = 1;
  core.handleGridKey({ x: 4, y: 0, state: true });
  assert.equal(core.patterns[0].recording, false);
  assert.equal(core.patterns[0].playing, true);
  core.handleGridKey({ x: 4, y: 0, state: true });
  assert.equal(core.patterns[0].playing, false);
});

// ─── Bottom row pattern buttons ───

test('bottom row pattern play buttons work', () => {
  const core = new MlrCore({ audio: null });
  core.gridkeyFN(8, 1); // x=8 = P1 play
  assert.equal(core.patterns[0].recording, true);
  core.patterns[0].events.push({ t: 1, i: 1, pos: 0, time: 0 });
  core.patterns[0].count = 1;
  core.gridkeyFN(8, 1);
  assert.equal(core.patterns[0].recording, false);
  assert.equal(core.patterns[0].playing, true);
});

test('bottom row pattern record buttons work', () => {
  const core = new MlrCore({ audio: null });
  core.gridkeyFN(12, 1); // x=12 = P1 rec
  assert.equal(core.patterns[0].recording, true);
  core.gridkeyFN(12, 1);
  assert.equal(core.patterns[0].recording, false);
});

// ─── Framebuffer ───

test('framebuffer has correct dimensions', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  assert.equal(frame.length, 8);
  assert.equal(frame[0].length, 16);
});

test('CUT view: nav row shows CUT view active', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  assert.ok(frame[0][1] >= 12, 'CUT nav LED should be bright');
  assert.ok(frame[0][0] < 12, 'REC nav LED should be dim');
});

test('bottom row shows STOP ALL', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  assert.ok(frame[7][3] > 0, 'STOP ALL should be visible on bottom row');
});

test('bottom row shows mode buttons', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  // x=4..7 = mode buttons, should be visible (even if dim)
  for (let x = 4; x <= 7; x++) {
    assert.ok(frame[7][x] >= 0, `mode button x=${x} should exist`);
  }
});

test('bottom row shows pattern buttons', () => {
  const core = new MlrCore({ audio: { positionSlice: () => -1 } });
  const frame = core.framebuffer();
  // x=8..11 = pattern play, x=12..15 = pattern record
  for (let x = 8; x <= 15; x++) {
    assert.ok(frame[7][x] >= 0, `pattern button x=${x} should exist`);
  }
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
  core.quantize = 1;
  core.handleGridKey({ x: 3, y: 2, state: true });
  assert.equal(calls.length, 0, 'events should be queued');
  core.clock.nextTime = 0;
  core.tick(1);
  assert.deepEqual(calls, [{ track: 2, slice: 3 }], 'events should execute on tick');
});
