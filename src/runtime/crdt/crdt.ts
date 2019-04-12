/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

export type VersionMap = Map<string, number>;

export class CRDTError extends Error {
}

export interface Operation<T> {}
export interface Data<T> {}

// A CRDT model is parameterized by:
//  - the operations that can be applied
//  - the internal data representation of the model
//  - the external (particle-facing) data representation of the model
// A CRDT model can:
//  - merge with other models. This produces a 2-sided delta 
//    (change from this model to merged model, change from other model to merged model).
//    Note that merge updates the model it is invoked on; the modelChange return value is 
//    a record of a change that has already been applied.
//  - apply an operation. This might fail (e.g. if the operation is out-of-order), in which case
//    applyOperation() will return false.
//  - report on internal data
//
// It is possible that two models can't merge. For example, they may have had divergent operations apply.
// This is a serious error and will result in merge throwing a CRDTError.
export interface CRDTModel<T> {
  merge(other: CRDTModel<T>): {modelChange: CRDTChange<T>, otherChange: CRDTChange<T>};
  applyOperation(op: Operation<T>): boolean;
  getData(): Data<T>;
}

//
//  - report on the particle's view of the data.
interface ConsumableCRDTModel<T, ConsumerType> extends CRDTModel<T> {
  getParticleView(): ConsumerType;
}

// A CRDT Change represents a delta between model states. Where possible,
// this delta should be expressed as a sequence of operations; in which case
// changeType will be ChangeType.Operations.
// Sometimes it isn't possible to express a delta as operations. In this case,
// changeType will be ChangeType.Model, and a full post-merge model will be supplied.
// A CRDT Change is parameterized by the operations that can be represented, and the data representation
// of the model.
export enum ChangeType {Operations, Model}
export interface CRDTChange<T> {
  change: {changeType: ChangeType.Operations, operations: Operation<T>[]} | {changeType: ChangeType.Model, modelPostChange: Data<T>};
}
