/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {assert} from '../../../platform/chai-web.js';
import {CRDTCount, CountOpTypes, CountOperation} from '../crdt-count.js';
import {CRDTError, ChangeType} from '../crdt.js';

describe('CRDTCount', () => {

  it('initially has value 0', () => {
    const count = new CRDTCount();
    assert.equal(count.getParticleView(), 0);
  });

  it('can apply an increment op', () => {
    const count = new CRDTCount();
    assert.isTrue(count.applyOperation(count.incrementOp('me')));
    assert.equal(count.getParticleView(), 1);
  });

  it('can apply two increment ops from different actors', () => {
    const count = new CRDTCount();
    assert.isTrue(count.applyOperation(count.incrementOp('me')));
    assert.isTrue(count.applyOperation(count.incrementOp('them')));
    assert.equal(count.getParticleView(), 2);
  });

  it('resolves increment ops from the same actor', () => {
    const count = new CRDTCount();
    assert.isTrue(count.applyOperation(count.incrementOp('me')));
    assert.isTrue(count.applyOperation(count.incrementOp('me')));
    assert.equal(count.getParticleView(), 2);
    assert.equal(count.getData().version.get('me'), 2);
  });

  it('does not resolve duplicated ops from the same actor', () => {
    const count = new CRDTCount();
    const op = count.incrementOp('me');
    assert.isTrue(count.applyOperation(op));
    assert.isFalse(count.applyOperation(op));
    assert.equal(count.getParticleView(), 1);
  });

  it('can apply a multi-increment op', () => {
    const count = new CRDTCount();
    count.applyOperation(count.multiIncrementOp(7, 'me'));
    assert.equal(count.getParticleView(), 7);
  });

  it('merges two models with counts from different actors', () => {
    const count1 = new CRDTCount();
    const count2 = new CRDTCount();
    count1.applyOperation(count1.multiIncrementOp(7, 'me'));
    count2.applyOperation(count2.multiIncrementOp(4, 'them'));
    const {modelChange, otherChange} = count1.merge(count2);
    assert.equal(count1.getParticleView(), 11);
    
    if (modelChange.change.changeType === ChangeType.Operations) {
      assert.equal(modelChange.change.operations.length, 1);
      assert.deepEqual(modelChange.change.operations[0].operation, {actor: 'them', value: 4, type: CountOpTypes.MultiIncrement, version: {from: 0, to: 1}});
    } else {
      assert.fail('modelChange.changeType should be ChangeType.Operations');
    }

    if (otherChange.change.changeType === ChangeType.Operations) {
      assert.equal(otherChange.change.operations.length, 1);
      assert.deepEqual(otherChange.change.operations[0].operation, {actor: 'me', value: 7, type: CountOpTypes.MultiIncrement, version: {from: 0, to: 1}});

      assert.isTrue(count2.applyOperation(otherChange.change.operations[0]));
      assert.deepEqual(count1.getData(), count2.getData());  
    } else {
      assert.fail('modelChange.changeType should be ChangeType.Operations');
    }
  });
  
  it('merges two models with counts from the same actor', () => {
    const count1 = new CRDTCount();
    const count2 = new CRDTCount();
    count1.applyOperation(CountOperation.newMultiIncrement(7, 'me', 0, 2));
    count2.applyOperation(CountOperation.newMultiIncrement(4, 'me', 0, 1));
    const {modelChange, otherChange} = count1.merge(count2);
    assert.equal(count1.getParticleView(), 7);
    
    if (modelChange.change.changeType === ChangeType.Operations) {
      assert.equal(modelChange.change.operations.length, 0);
    } else {
      assert.fail('modelChange.changeType should be ChangeType.Operations');
    }

    if (otherChange.change.changeType === ChangeType.Operations) {
      assert.equal(otherChange.change.operations.length, 1);
      assert.deepEqual(otherChange.change.operations[0].operation, {actor: 'me', value: 3, type: CountOpTypes.MultiIncrement, version: {from: 1, to: 2}});

      assert.isTrue(count2.applyOperation(otherChange.change.operations[0]));
      assert.deepEqual(count1.getData(), count2.getData());
    } else {
      assert.fail('modelChange.changeType should be ChangeType.Operations');
    }
  });

  it('throws when attempting to merge divergent models', () => {
    const count1 = new CRDTCount();
    const count2 = new CRDTCount();
    count1.applyOperation(count1.multiIncrementOp(7, 'me'));
    count2.applyOperation(count2.multiIncrementOp(4, 'me'));
    assert.throws(() => count1.merge(count2), CRDTError);
  });

  it('throws when values appear to have been decremented', () => {
    const count1 = new CRDTCount();
    const count2 = new CRDTCount();
    count1.applyOperation(CountOperation.newMultiIncrement(7, 'me', 0, 1));
    count2.applyOperation(CountOperation.newMultiIncrement(4, 'me', 0, 2));
    assert.throws(() => count1.merge(count2), CRDTError);
  });

  it('merges two models with counts from the multiple actors', () => {
    const count1 = new CRDTCount();
    const count2 = new CRDTCount();
    count1.applyOperation(CountOperation.newMultiIncrement(6, 'a', 0, 1));
    count1.applyOperation(CountOperation.newMultiIncrement(12, 'c', 0, 2));
    count1.applyOperation(CountOperation.newMultiIncrement(22, 'd', 0, 1));
    count1.applyOperation(CountOperation.newMultiIncrement(4, 'e', 0, 1));
    count2.applyOperation(CountOperation.newMultiIncrement(5, 'b', 0, 1));
    count2.applyOperation(CountOperation.newMultiIncrement(9, 'c', 0, 1));
    count2.applyOperation(CountOperation.newMultiIncrement(22, 'd', 0, 1));
    count2.applyOperation(CountOperation.newMultiIncrement(14, 'e', 0, 2));

    const {modelChange, otherChange} = count1.merge(count2);
    assert.equal(count1.getParticleView(), 59); // expect 5 / 6 / 12 / 22 / 14
    
    if (modelChange.change.changeType === ChangeType.Operations) {
      assert.equal(modelChange.change.operations.length, 2);
      assert.deepEqual(modelChange.change.operations[0].operation, {actor: 'b', value: 5, type: CountOpTypes.MultiIncrement, version: {from: 0, to: 1}});
      assert.deepEqual(modelChange.change.operations[1].operation, {actor: 'e', value: 10, type: CountOpTypes.MultiIncrement, version: {from: 1, to: 2}});
    } else {
      assert.fail('modelChange.changeType should be ChangeType.Operations');
    }

    if (otherChange.change.changeType === ChangeType.Operations) {
      assert.equal(otherChange.change.operations.length, 2);
      assert.deepEqual(otherChange.change.operations[0].operation, {actor: 'c', value: 3, type: CountOpTypes.MultiIncrement, version: {from: 1, to: 2}});
      assert.deepEqual(otherChange.change.operations[1].operation, {actor: 'a', value: 6, type: CountOpTypes.MultiIncrement, version: {from: 0, to: 1}});
  
      assert.isTrue(count2.applyOperation(otherChange.change.operations[0]));
      assert.isTrue(count2.applyOperation(otherChange.change.operations[1]));
      assert.deepEqual(count1.getData(), count2.getData());
    } else {
      assert.fail('modelChange.changeType should be ChangeType.Operations');
    }
  });
});