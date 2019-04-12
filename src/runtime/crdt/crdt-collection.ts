/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {VersionMap, CRDTChange, CRDTModel, Data, Operation} from "./crdt.js";

type RawCollection<T> = Set<T>;

type Collection = "Collection";

type CollectionValue<T> = {value: T, clock: VersionMap};

interface CollectionData<T> extends Data<Collection> {
  values: Set<{value: T, clock: VersionMap}>;
  version: VersionMap;
}

enum CollectionOpTypes {Add, Remove}
type CollectionOperationImpl<T> = {type: CollectionOpTypes.Add, added: CollectionValue<T>} |
                              {type: CollectionOpTypes.Remove, removed: T};

interface CollectionOperation<T> extends Operation<Collection> {
  operation: CollectionOperationImpl<T>;
}

interface CollectionChange<T> extends CRDTChange<Collection> {}

interface CollectionModel<T> extends CRDTModel<Collection> {}
