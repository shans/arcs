/**
 * @license
 * Copyright (c) 2020 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {StorageProxy} from './storage-proxy.js';
import {Type, CollectionType, EntityType, ReferenceType, SingletonType, InterfaceType, MuxType} from '../type.js';
import {Ttl} from '../recipe/ttl.js';
import {SingletonHandle, CollectionHandle, Handle} from './handle.js';
import {Particle} from '../particle.js';
import {CRDTSingletonTypeRecord} from '../crdt/crdt-singleton.js';
import {ActiveStore, Store, StoreMuxer} from './store.js';
import {Entity, SerializedEntity} from '../entity.js';
import {Id, IdGenerator} from '../id.js';
import {ParticleSpec, StorableSerializedParticleSpec} from '../particle-spec.js';
import {CRDTCollectionTypeRecord} from '../crdt/crdt-collection.js';
import {SerializedReference, Reference} from '../reference.js';
import {StoreInfo, AbstractStore, ToActiveStore} from './abstract-store.js';
import {StorageKey} from './storage-key.js';
import {Exists} from './drivers/driver.js';
import {CRDTTypeRecord} from '../crdt/crdt.js';
import { CRDTEntityTypeRecord, Identified } from '../crdt/crdt-entity.js';
import { ActiveMuxer } from './store-interface.js';
import { EntityHandleFactory } from './entity-handle-factory.js';
import { StorageProxyMuxer } from './storage-proxy-muxer.js';
import { assert } from '../../platform/assert-node.js';

type HandleOptions = {
  type?: Type;
  ttl?: Ttl;
  particle?: Particle;
  canRead?: boolean;
  canWrite?: boolean;
  name?: string;
};

type ArcLike = {
  generateID: () => Id;
  idGenerator: IdGenerator;
};

export type SingletonEntityType = SingletonType<EntityType>;
export type CRDTEntitySingleton = CRDTSingletonTypeRecord<SerializedEntity>;
export type SingletonEntityStore = Store<CRDTEntitySingleton>;
export type ActiveSingletonEntityStore = ActiveStore<SingletonEntityType, CRDTEntitySingleton>;
export type SingletonEntityHandle = SingletonHandle<Entity>;

export type CollectionEntityType = CollectionType<EntityType>;
export type CRDTEntityCollection = CRDTCollectionTypeRecord<SerializedEntity>;
export type CollectionEntityStore = Store<CRDTEntityCollection>;
export type ActiveCollectionEntityStore = ActiveStore<CollectionEntityType, CRDTEntityCollection>;
export type CollectionEntityHandle = CollectionHandle<Entity>;

export type SingletonReferenceType = SingletonType<ReferenceType<EntityType>>;
export type CRDTReferenceSingleton = CRDTSingletonTypeRecord<SerializedReference>;
export type SingletonReferenceStore = Store<CRDTReferenceSingleton>;
export type ActiveSingletonReferenceStore = ActiveStore<SingletonReferenceType, CRDTReferenceSingleton>;
export type SingletonReferenceHandle = SingletonHandle<Reference>;

export type CollectionReferenceType = CollectionType<ReferenceType<EntityType>>;
export type CRDTReferenceCollection = CRDTCollectionTypeRecord<SerializedReference>;
export type CollectionReferenceStore = Store<CRDTReferenceCollection>;
export type ActiveCollectionReferenceStore = ActiveStore<CollectionReferenceType, CRDTReferenceCollection>;
export type CollectionReferenceHandle = CollectionHandle<Reference>;

export type SingletonInterfaceType = SingletonType<InterfaceType>;
export type CRDTInterfaceSingleton = CRDTSingletonTypeRecord<StorableSerializedParticleSpec>;
export type SingletonInterfaceStore = Store<CRDTInterfaceSingleton>;
export type ActiveSingletonInterfaceStore = ActiveStore<SingletonInterfaceType, CRDTInterfaceSingleton>;
export type SingletonInterfaceHandle = SingletonHandle<ParticleSpec>;

export type NonMuxType = 
  SingletonEntityType |
  CollectionEntityType |
  SingletonReferenceType |
  CollectionReferenceType |
  SingletonInterfaceType;

export type MuxEntityType = MuxType<EntityType>;
export type CRDTMuxEntity = CRDTEntityTypeRecord<Identified, Identified>;
export type MuxEntityStore = StoreMuxer<CRDTMuxEntity>;
export type ActiveMuxEntityStore = ActiveMuxer<CRDTMuxEntity>;
export type MuxEntityHandle = EntityHandleFactory<CRDTMuxEntity>;

export type ToStore<T extends Type>
  = T extends CollectionEntityType ? CollectionEntityStore :
   (T extends CollectionReferenceType ? CollectionReferenceStore :
   (T extends SingletonEntityType ? SingletonEntityStore :
   (T extends SingletonReferenceType ? SingletonReferenceStore :
   (T extends SingletonInterfaceType ? SingletonInterfaceStore :
   (T extends MuxEntityType ? MuxEntityStore :
    Store<CRDTTypeRecord>)))));

export type ToActive<T extends Store<CRDTTypeRecord>>
  = T extends CollectionEntityStore ? ActiveCollectionEntityStore :
   (T extends CollectionReferenceStore ? ActiveCollectionReferenceStore :
   (T extends SingletonEntityStore ? ActiveSingletonEntityStore :
   (T extends SingletonReferenceStore ? ActiveSingletonReferenceStore :
   (T extends SingletonInterfaceStore ? ActiveSingletonInterfaceStore :
    ActiveStore<Type, CRDTTypeRecord>))));

export type ToType<T extends Store<CRDTTypeRecord>>
  = T extends CollectionEntityStore ? CollectionEntityType :
   (T extends CollectionReferenceStore ? CollectionReferenceType :
   (T extends SingletonEntityStore ? SingletonEntityType :
   (T extends SingletonReferenceStore ? SingletonReferenceType :
   (T extends SingletonInterfaceStore ? SingletonInterfaceType :
    Type))));

export type HandleToType<T extends Handle<CRDTTypeRecord>>
  = T extends CollectionEntityHandle ? CollectionEntityType :
  (T extends CollectionReferenceHandle ? CollectionReferenceType :
  (T extends SingletonEntityHandle ? SingletonEntityType :
  (T extends SingletonReferenceHandle ? SingletonReferenceType :
  (T extends SingletonInterfaceHandle ? SingletonInterfaceType :
   Type))));

export type TypeToCRDTTypeRecord<T extends Type> 
  = T extends SingletonEntityType ? CRDTEntitySingleton :
  (T extends CollectionEntityType ? CRDTEntityCollection :
  (T extends SingletonReferenceType ? CRDTReferenceSingleton : 
  (T extends CollectionReferenceType ? CRDTReferenceCollection :
  (T extends SingletonInterfaceType ? CRDTInterfaceSingleton : 
  (T extends MuxEntityType ? CRDTMuxEntity :
  CRDTTypeRecord)))));

export type CRDTTypeRecordToType<T extends CRDTTypeRecord>
  = T extends CRDTEntitySingleton ? SingletonEntityType :
  (T extends CRDTEntityCollection ? CollectionEntityType :
  (T extends CRDTReferenceSingleton ? SingletonReferenceType :
  (T extends CRDTReferenceCollection ? CollectionReferenceType :
  (T extends CRDTInterfaceSingleton ? SingletonInterfaceType :
  (T extends CRDTMuxEntity ? MuxEntityType :
  Type)))));

// export type ToHandle<T extends ActiveMuxer<CRDTTypeRecord>> = never;
// export type ToHandle<T extends ActiveMuxer<CRDTTypeRecord>> = 
//   T extends ActiveMuxEntityStore ? MuxEntityHandle : never;

// export type ToHandle<T extends ToActiveStore<Type>> = T extends ActiveMuxEntityStore ? MuxEntityHandle : MuxEntityHandle;

export type ToHandle<T extends Type, U extends ToActiveStore<T>>
  = U extends ActiveCollectionEntityStore ? CollectionEntityHandle :
   (U extends ActiveCollectionReferenceStore ? CollectionReferenceHandle :
   (U extends ActiveSingletonEntityStore ? SingletonEntityHandle :
   (U extends ActiveSingletonReferenceStore ? SingletonReferenceHandle :
   (U extends ActiveSingletonInterfaceStore ? SingletonInterfaceHandle :
   (U extends ActiveMuxEntityStore ? MuxEntityHandle :
    never)))));

export function newStore<T extends Type>(type: T, opts: StoreInfo & {storageKey: StorageKey, exists: Exists}): ToStore<T> {
  if (type.isMuxType()) {
    return new StoreMuxer(type, opts) as ToStore<T>;
  }
  return new Store(type, opts) as ToStore<T>;
}

export function storeType<T extends Store<CRDTTypeRecord>>(store: T) {
  return store.type as ToType<T>;
}

export function handleType<T extends Handle<CRDTTypeRecord>>(handle: T) {
  return handle.type as HandleToType<T>;
}

export async function newHandle<T extends Type>(type: T, storageKey: StorageKey, arc: ArcLike, options: StoreInfo & HandleOptions): Promise<ToHandle<ToActive<ToStore<T>>>> {
  options['storageKey'] = storageKey;
  options['exists'] = Exists.MayExist;
  const store = newStore(type, options as StoreInfo & {storageKey: StorageKey, exists: Exists});
  return handleForStore(store, arc, options);
}

export function handleForActiveStore<T extends Type, U extends CRDTTypeRecord>(
  store: ToActiveStore<T>,
  arc: ArcLike,
  options: HandleOptions = {}
): ToHandle<T, ToActiveStore<T>> {
  const type = options.type || store.baseStore.type;
  const storageKey = store.baseStore.storageKey.toString();
  const proxy = new StorageProxy<U>(store.baseStore.id, store, type, storageKey, options.ttl);
  const idGenerator = arc.idGenerator;
  const particle = options.particle || null;
  const canRead = (options.canRead != undefined) ? options.canRead : true;
  const canWrite = (options.canWrite != undefined) ? options.canWrite : true;
  const name = options.name || null;
  const generateID = arc.generateID ? () => arc.generateID().toString() : () => '';
  if (type instanceof MuxType) {
    const proxyMuxer = new StorageProxyMuxer<CRDTMuxEntity>(store, type, storageKey);
    return new EntityHandleFactory(proxyMuxer) as ToHandle<T, ToActiveStore<T>>;
  }

  if (type instanceof SingletonType) {
    // tslint:disable-next-line: no-any
    return new SingletonHandle(generateID(), proxy as any, idGenerator, particle, canRead, canWrite, name) as ToHandle<T, ActiveStore<T, TypeToCRDTTypeRecord<T>>>;
  } else {
    // tslint:disable-next-line: no-any
    return new CollectionHandle(generateID(), proxy as any, idGenerator, particle, canRead, canWrite, name) as ToHandle<ToActiveStore<T>>;
  }
}

export async function handleForStore<T extends Type, U extends CRDTTypeRecord>(store: Store<U>, arc: ArcLike, options?: HandleOptions): Promise<ToHandle<ToActive<ToStore<T>>>> {
  return handleForActiveStore(await store.activate(), arc, options) ;
}
