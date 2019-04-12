/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {VersionMap, CRDTChange, CRDTModel, CRDTError, ChangeType, Operation, Data} from "./crdt.js";

type RawCount = number;

type Count = "Count";

interface CountData extends Data<Count> {
  values: Map<string, number>; 
  version: VersionMap;
}

type VersionInfo = {from: number, to: number};

export enum CountOpTypes {Increment, MultiIncrement}
type CountOperationImpl = {type: CountOpTypes.MultiIncrement, value: number, actor: string, version: VersionInfo} | 
{type: CountOpTypes.Increment, actor: string, version: VersionInfo};

export class CountOperation implements Operation<Count> {
  operation: CountOperationImpl;

  constructor(operation: CountOperationImpl) {
    this.operation = operation;
  }
  static newMultiIncrement(value: number, actor: string, from: number, to: number) {
    return new CountOperation({type: CountOpTypes.MultiIncrement, value, actor, version: {from, to}}); 
  }

  static newIncrement(actor: string, from: number) {
    return new CountOperation({type: CountOpTypes.Increment, actor, version: {from, to: from + 1}});
  }
}

interface CountChange extends CRDTChange<Count> {
  change: {changeType: ChangeType.Operations, operations: CountOperation[]} | {changeType: ChangeType.Model, modelPostChange: CountData};
}

interface CountModel extends CRDTModel<Count> {}

export class CRDTCount implements CountModel {
  private model: CountData = {values: new Map(), version: new Map()};

  merge(other: CRDTCount): {modelChange: CountChange, otherChange: CountChange} {
    const otherChanges: CountOperation[] = [];
    const thisChanges: CountOperation[] = [];

    const otherRaw = other.getData();

    for (const key of otherRaw.values.keys()) {
      const thisValue = this.model.values.get(key) || 0;
      const otherValue = otherRaw.values.get(key) || 0;
      const thisVersion = this.model.version.get(key) || 0;
      const otherVersion = otherRaw.version.get(key) || 0;
      if (thisValue > otherValue) {
        if (otherVersion >= thisVersion) {
          throw new CRDTError('Divergent versions encountered when merging CRDTCount models');
        }
        otherChanges.push(CountOperation.newMultiIncrement(thisValue - otherValue, key, otherVersion, thisVersion));
      } else if (otherValue > thisValue) {
        if (thisVersion >= otherVersion) {
          throw new CRDTError('Divergent versions encountered when merging CRDTCount models');
        }
        thisChanges.push(CountOperation.newMultiIncrement(otherValue - thisValue, key, thisVersion, otherVersion));
        this.model.values.set(key, otherValue);
        this.model.version.set(key, otherVersion);
      }
    }
    
    for (const key of this.model.values.keys()) {
      if (otherRaw.values.has(key)) {
        continue;
      }
      if (otherRaw.version.has(key)) {
        throw new CRDTError(`CRDTCount model has version but no value for key ${key}`);
      }
      otherChanges.push({operation: {type: CountOpTypes.MultiIncrement, value: this.model.values.get(key), actor: key,
                                     version: {from: 0, to: this.model.version.get(key)}}});
    }

    return {modelChange: {change: {changeType: ChangeType.Operations, operations: thisChanges}}, 
            otherChange: {change: {changeType: ChangeType.Operations, operations: otherChanges}}};
  }

  multiIncrementOp(value: number, actor: string): CountOperation {
    const from = this.model.version.get(actor) || 0;
    return CountOperation.newMultiIncrement(value, actor, from, from + 1);
  }

  incrementOp(actor: string): CountOperation {
    const from = this.model.version.get(actor) || 0;
    return CountOperation.newIncrement(actor, from);
  }

  applyOperation({operation}: CountOperation) {
    let value: number;
    if (operation.version.from !== (this.model.version.get(operation.actor) || 0)) {
      return false;
    }
    if (operation.version.to <= operation.version.from) {
      return false;
    }
    if (operation.type === CountOpTypes.MultiIncrement) {
      if (operation.value < 0) {
        return false;
      }
      value = (this.model.values.get(operation.actor) || 0) + operation.value;
    } else {
      value = (this.model.values.get(operation.actor) || 0) + 1;
    }

    this.model.values.set(operation.actor, value);
    this.model.version.set(operation.actor, operation.version.to);
    return true;
  }

  getData(): CountData {
    return this.model;
  }

  getParticleView(): RawCount {
    return [...this.model.values.values()].reduce((prev, current) => prev + current, 0);
  }
}
