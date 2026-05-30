import test from 'node:test';
import assert from 'node:assert/strict';
import {sliceForPad, MlrCore} from '../js/mlr-core.js';
import {parseMonomePackets} from '../js/monome.js';

test('8x16 grid maps every column directly to slices 1-16', () => {
  assert.equal(sliceForPad(0),0);
  assert.equal(sliceForPad(7),7);
  assert.equal(sliceForPad(8),8);
  assert.equal(sliceForPad(15),15);
});

test('8x16 framebuffer exposes all sixteen slice columns', () => {
  const core = new MlrCore({audio:{positionSlice:()=>15}});
  const frame = core.framebuffer();
  assert.equal(frame.length,8);
  assert.equal(frame[0].length,16);
  assert.equal(frame[0][15],15);
});

test('quantized events queue until clock tick', () => {
  const calls=[];
  const core = new MlrCore({audio:{jump:(track,slice)=>calls.push({track,slice}), positionSlice:()=>-1}});
  core.setQuantize(true);
  core.handleGridKey({x:3,y:2,state:true});
  assert.equal(calls.length,0);
  core.clock.nextTime=0; core.tick(1);
  assert.deepEqual(calls,[{track:2,slice:3}]);
});

test('monome parser extracts key packets', () => {
  assert.deepEqual(parseMonomePackets([0x21,2,3,0x20,2,3]), [{x:2,y:3,state:true},{x:2,y:3,state:false}]);
});

test('monome parser preserves 8x16 column coordinates', () => {
  assert.deepEqual(parseMonomePackets([0x21,15,6]), [{x:15,y:6,state:true}]);
});
