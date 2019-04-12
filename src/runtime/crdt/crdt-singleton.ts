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

type Singleton = "Singleton";

type RawSingleton<T> = T;

interface SingletonData<T> extends Data<Singleton> {
  values: Set<{ value: T, clock: VersionMap }>;
  version: VersionMap;
}

type SingletonOperationImpl<T> = {from: T | null, to: T | null, actor: string};
interface SingletonOperation<T> extends Operation<Singleton> {
  operation: SingletonOperationImpl<T>;
}

interface SingletonChange<T> extends CRDTChange<Singleton> {}

interface SingletonModel<T> extends CRDTModel<Singleton> {}

