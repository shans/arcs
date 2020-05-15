/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {assert} from '../../platform/assert-web.js';
import {PropagatedException} from '../arc-exceptions.js';
import {CRDTTypeRecord} from '../crdt/crdt.js';
import {Type} from '../type.js';
import {Exists} from './drivers/driver.js';
import {StorageKey} from './storage-key.js';
import {StorageProxy} from './storage-proxy.js';
import {Store} from './store.js';
import {Producer} from '../hot.js';
import {ChannelConstructor} from '../channel-constructor.js';
import {StorageProxyMuxer} from './storage-proxy-muxer.js';
import {noAwait} from '../util.js';
import { ToActiveStore, AbstractStore } from './abstract-store.js';
import { MuxEntityType } from './storage-ng.js';

/**
 * This file exists to break a circular dependency between Store and the ActiveStore implementations.
 * Source code outside of the storageNG directory should not import this file directly; instead use
 * store.ts, which re-exports all the useful symbols.
 */

export enum StorageMode {Direct, Backing, ReferenceMode}

export enum ProxyMessageType {SyncRequest, ModelUpdate, Operations}

export type ProxyMessage<T extends CRDTTypeRecord> =
  {type: ProxyMessageType.SyncRequest, id?: number, muxId?: string} |
  {type: ProxyMessageType.ModelUpdate, model: T['data'], id?: number, muxId?: string} |
  {type: ProxyMessageType.Operations, operations: T['operation'][], id?: number, muxId?: string};

export type ProxyCallback<T extends CRDTTypeRecord> = (message: ProxyMessage<T>) => Promise<void>;

export type StoreInterface<T extends CRDTTypeRecord> = {
  readonly storageKey: StorageKey;
  exists: Exists;
  readonly type: Type;
  readonly mode: StorageMode;
};

export type StoreConstructorOptions<U extends Type> = {
  storageKey: StorageKey,
  exists: Exists,
  type: U,
  mode: StorageMode,
  baseStore: AbstractStore<U>,
  versionToken: string
};

export type StoreConstructor = {
  construct<T extends Type>(options: StoreConstructorOptions<T>): Promise<ToActiveStore<T>>;
};

// Interface common to an ActiveStore and the PEC, used by the StorageProxy.
export interface StorageCommunicationEndpoint<T extends CRDTTypeRecord> {
  setCallback(callback: ProxyCallback<T>): void;
  reportExceptionInHost(exception: PropagatedException): void;
  onProxyMessage(message: ProxyMessage<T>): Promise<void>;
  getChannelConstructor: Producer<ChannelConstructor>;
}

export interface StorageCommunicationEndpointProvider<T extends CRDTTypeRecord> {
  getStorageEndpoint(storageProxy: StorageProxy<T> | StorageProxyMuxer<T>): StorageCommunicationEndpoint<T>;
}

export interface AbstractActiveStore<T extends CRDTTypeRecord> {
  versionToken: string;
}

// A representation of an active store. Subclasses of this class provide specific
// behaviour as controlled by the provided StorageMode.
export abstract class ActiveStore<T extends Type, U extends CRDTTypeRecord>
    implements StoreInterface<U>, StorageCommunicationEndpointProvider<U>, AbstractActiveStore<U> {
  readonly storageKey: StorageKey;
  exists: Exists;
  readonly type: T;
  readonly mode: StorageMode;
  readonly baseStore: AbstractStore<T>;
  readonly versionToken: string;

  // TODO: Lots of these params can be pulled from baseStore.
  constructor(options: StoreConstructorOptions<T>) {
    this.storageKey = options.storageKey;
    this.exists = options.exists;
    this.type = options.type;
    this.mode = options.mode;
    this.baseStore = options.baseStore;
  }

  async idle() {
    return Promise.resolve();
  }

  // tslint:disable-next-line no-any
  abstract async serializeContents(): Promise<U['data']>;

  async cloneFrom(store: ActiveStore<T, U>): Promise<void> {
    // TODO(shans): work out what ID to use for messages that aren't from an established
    // channel, like these.
    assert(store instanceof ActiveStore);
    const activeStore: ActiveStore<T, U> = store as ActiveStore<T, U>;
    assert(this.mode === activeStore.mode);
    await this.onProxyMessage({
      type: ProxyMessageType.ModelUpdate,
      model: await activeStore.serializeContents(),
      id: 0
    });
  }

  async modelForSynchronization(): Promise<{}> {
    return this.serializeContents();
  }

  abstract on(callback: ProxyCallback<U>): number;
  abstract off(callback: number): void;
  abstract async onProxyMessage(message: ProxyMessage<U>): Promise<void>;
  abstract reportExceptionInHost(exception: PropagatedException): void;

  getStorageEndpoint() {
    const store = this;
    let id: number;
    return {
      async onProxyMessage(message: ProxyMessage<U>): Promise<void> {
        message.id = id!;
        noAwait(store.onProxyMessage(message));
      },

      setCallback(callback: ProxyCallback<U>) {
        id = store.on(callback);
      },
      reportExceptionInHost(exception: PropagatedException): void {
        store.reportExceptionInHost(exception);
      },
      getChannelConstructor(): ChannelConstructor {
        // TODO(shans): implement so that we can use references outside of the PEC.
        return {
          generateID() {
            throw new Error('References not yet supported outside of the PEC');
          },
          idGenerator: null,
          getStorageProxyMuxer() {
            throw new Error('References not yet supported outside of the PEC');
          },
          reportExceptionInHost(exception: PropagatedException): void {
            store.reportExceptionInHost(exception);
          }
        };
      }
    };
  }
}

export abstract class ActiveMuxer<T extends CRDTTypeRecord> implements StorageCommunicationEndpointProvider<T>, AbstractActiveStore<T> {
  abstract versionToken: string;
  readonly baseStore: AbstractStore<MuxEntityType>;

  // TODO: Lots of these params can be pulled from baseStore.
  constructor(options: StoreConstructorOptions<MuxEntityType>) {
    this.baseStore = options.baseStore;
  }


  abstract on(callback: ProxyCallback<T>): number;
  abstract off(callback: number): void;
  abstract async onProxyMessage(message: ProxyMessage<T>): Promise<void>;
  abstract reportExceptionInHost(exception: PropagatedException): void;
  
  getStorageEndpoint() {
    const directStoreMuxer = this;
    let id: number;
    return {
      async onProxyMessage(message: ProxyMessage<T>): Promise<void> {
        message.id = id!;
        noAwait(directStoreMuxer.onProxyMessage(message));
      },
      setCallback(callback: ProxyCallback<T>) {
        id = directStoreMuxer.on(callback);
      },
      reportExceptionInHost(exception: PropagatedException): void {
        directStoreMuxer.reportExceptionInHost(exception);
      },
      getChannelConstructor(): ChannelConstructor {
        return {
          generateID() {
            return null;
          },
          idGenerator: null,
          getStorageProxyMuxer() {
            throw new Error('unimplemented, should not be called');
          },
          reportExceptionInHost(exception: PropagatedException): void {
          }
        };
      }
    };
  }

}
