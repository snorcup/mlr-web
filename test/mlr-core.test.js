import test from 'node:test';
import assert from 'node:assert/strict';
import {sliceForPad, MlrCore} from '../js/mlr-core.js';
import {parseMonomePackets} from '../js/monome.js';

test('modifier maps classic 8 pad row to slices 9-16', () => {
  assert.equal(sliceForPad(0,false),0);
  assert.equal(sliceForPad(7,false),7);
  assert.equal(sliceForPad(0,true),8);
  assert.equal(sliceForPad(7,true),15);
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
