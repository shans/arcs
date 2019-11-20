/*
 * Copyright 2019 Google LLC.
 *
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 *
 * Code distributed by Google as part of this project is also subject to an additional IP rights
 * grant found at
 * http://polymer.github.io/PATENTS.txt
 */

package arcs.storage

import arcs.common.ReferenceId
import arcs.crdt.CrdtCount
import arcs.crdt.CrdtEntity
import arcs.crdt.CrdtException
import arcs.crdt.CrdtSet
import arcs.crdt.internal.VersionMap
import arcs.data.CollectionType
import arcs.data.CountType
import arcs.data.EntityType
import arcs.data.RawEntity
import arcs.data.Schema
import arcs.data.SchemaDescription
import arcs.data.SchemaFields
import arcs.data.SchemaName
import arcs.data.SingletonType
import arcs.data.util.toReferencable
import arcs.storage.referencemode.RefModeStoreData
import arcs.storage.referencemode.RefModeStoreOp
import arcs.storage.referencemode.RefModeStoreOutput
import arcs.storage.referencemode.Reference
import arcs.storage.referencemode.ReferenceModeStorageKey
import arcs.storage.referencemode.toReference
import arcs.testutil.assertSuspendingThrows
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runBlockingTest
import org.junit.After
import org.junit.Before
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

/** Tests for the [ReferenceModeStore]. */
@Suppress("UNCHECKED_CAST")
@RunWith(JUnit4::class)
@ExperimentalCoroutinesApi
class ReferenceModeStoreTest {
    private lateinit var testKey: ReferenceModeStorageKey
    private lateinit var baseStore: Store<CrdtCount.Data, CrdtCount.Operation, Int>
    private lateinit var schema: Schema

    @Before
    fun setup() = runBlockingTest {
        testKey = ReferenceModeStorageKey(
            MockHierarchicalStorageKey(),
            MockHierarchicalStorageKey()
        )
        baseStore = Store(StoreOptions(testKey, ExistenceCriteria.ShouldCreate, CountType()))
        schema = Schema(
            listOf(SchemaName("person")),
            SchemaFields(setOf("age", "name"), emptySet()),
            SchemaDescription()
        )

        DriverFactory.clearRegistrationsForTesting()
    }

    @After
    fun teardown() {
        DriverFactory.clearRegistrationsForTesting()
    }

    @Test
    fun throwsException_ifAppropriateDriverCantBeFound() = runBlockingTest {
        val store = Store<RefModeStoreData, RefModeStoreOp, RefModeStoreOutput>(
            StoreOptions(
                testKey,
                ExistenceCriteria.ShouldCreate,
                SingletonType(EntityType(schema)),
                StorageMode.ReferenceMode
            )
        )
        assertSuspendingThrows(CrdtException::class) { store.activate() }
    }

    @Test
    fun constructsReferenceModeStores_whenRequired() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val store = Store<RefModeStoreData, RefModeStoreOp, RefModeStoreOutput>(
            StoreOptions(
                testKey,
                ExistenceCriteria.ShouldCreate,
                CollectionType(EntityType(schema)),
                mode = StorageMode.ReferenceMode
            )
        )
        val activeStore = store.activate()

        assertThat(activeStore).isInstanceOf(ReferenceModeStore::class.java)
    }

    @Test
    fun propagatesModelUpdates_fromProxies_toDrivers() = runBlockingTest {
        val driverProvider = MockDriverProvider()
        DriverFactory.register(driverProvider)

        val activeStore = createReferenceModeStore()

        val collection = CrdtSet<RawEntity>()
        val entity = createPersonEntity("an-id", "bob", 42)
        collection.applyOperation(
            CrdtSet.Operation.Add(VersionMap("me" to 1), "me", entity)
        )

        assertThat(
            activeStore.onProxyMessage(
                ProxyMessage.ModelUpdate(RefModeStoreData.Set(collection.data), 1)
            )
        ).isTrue()

        val actor = activeStore.crdtKey

        val containerStoreDriver = requireNotNull(
            activeStore.containerStore.driver as? MockDriver<CrdtSet.Data<Reference>>
        ) { "ContainerStore Driver is not of expected type: CrdtSet.Data<Reference>" }

        val capturedCollection = containerStoreDriver.sentData.first()

        assertThat(capturedCollection.values)
            .containsExactly(
                "an-id",
                CrdtSet.DataValue(
                    VersionMap("me" to 1),
                    Reference("an-id", activeStore.backingStore.storageKey, VersionMap(actor to 1))
                )
            )

        val bobDriver = activeStore.backingStore.getEntityDriver("an-id")
        val capturedBob = bobDriver.sentData.first()
        assertThat(capturedBob.singletons["name"]?.data?.versionMap)
            .isEqualTo(VersionMap(actor to 1))
        assertThat(capturedBob.singletons["age"]?.data?.versionMap)
            .isEqualTo(VersionMap(actor to 1))
        assertThat(capturedBob.toRawEntity().singletons)
            .containsExactly(
                "name", "bob".toReferencable(),
                "age", 42.toReferencable()
            )
    }

    @Test
    fun canCloneData_fromAnotherStore() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        // Add some data.
        val collection = CrdtSet<RawEntity>()
        val entity = createPersonEntity("an-id", "bob", 42)
        collection.applyOperation(
            CrdtSet.Operation.Add(VersionMap("me" to 1), "me", entity)
        )
        activeStore.onProxyMessage(
            ProxyMessage.ModelUpdate(RefModeStoreData.Set(collection.data), 1)
        )

        // Clone
        val activeStore2 = createReferenceModeStore()
        activeStore2.cloneFrom(activeStore)

        assertThat(activeStore2.getLocalData()).isEqualTo(activeStore.getLocalData())
        assertThat(activeStore2.getLocalData() === activeStore.getLocalData()).isFalse()
    }

    @Test
    fun appliesAndPropagatesOperationUpdate_fromProxies_toDrivers() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()
        val actor = activeStore.crdtKey

        val personCollection = CrdtSet<RawEntity>()
        val bob = createPersonEntity("an-id", "bob", 42)
        val operation = CrdtSet.Operation.Add(VersionMap("me" to 1), "me", bob)

        val referenceCollection = CrdtSet<Reference>()
        val bobRef = Reference(
            "an-id",
            activeStore.backingStore.storageKey,
            VersionMap(actor to 1)
        )
        val refOperation = CrdtSet.Operation.Add(VersionMap(actor to 1), actor, bobRef)

        val bobEntity = createPersonEntityCrdt()

        // Apply to RefMode store.
        assertThat(
            activeStore.onProxyMessage(
                ProxyMessage.Operations(
                    listOf(RefModeStoreOp.SetAdd(actor, VersionMap(actor to 1), bob)),
                    id = 1
                )
            )
        ).isTrue()

        // Apply to expected collection representation
        assertThat(personCollection.applyOperation(operation)).isTrue()
        // Apply to expected refMode collectionStore data.
        assertThat(referenceCollection.applyOperation(refOperation)).isTrue()
        // Apply to expected refMode backingStore data.
        assertThat(
            bobEntity.applyOperation(
                CrdtEntity.Operation.SetSingleton(
                    actor,
                    VersionMap(actor to 1),
                    "name",
                    CrdtEntity.ReferenceImpl("bob".toReferencable().id)
                )
            )
        ).isTrue()
        assertThat(
            bobEntity.applyOperation(
                CrdtEntity.Operation.SetSingleton(
                    actor,
                    VersionMap(actor to 1),
                    "age",
                    CrdtEntity.ReferenceImpl(42.toReferencable().id)
                )
            )
        ).isTrue()

        val containerDriver =
            activeStore.containerStore.driver as MockDriver<CrdtSet.Data<Reference>>

        val capturedPeople = containerDriver.sentData.first()
        assertThat(capturedPeople).isEqualTo(referenceCollection.data)
        val storedBob = activeStore.backingStore.getLocalData("an-id") as CrdtEntity.Data
        // Check that the stored bob's singleton data is equal to the expected bob's singleton data
        assertThat(storedBob.singletons.mapValues { it.value.data })
            .isEqualTo(bobEntity.data.singletons.mapValues { it.value.data })
        // Check that the stored bob's collection data is equal to the expected bob's collection
        // data (empty)
        assertThat(storedBob.collections.mapValues { it.value.data })
            .isEqualTo(bobEntity.data.collections.mapValues { it.value.data })
    }

    @Test
    fun respondsToAModelRequest_fromProxy_withModel() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        val entityCollection = CrdtSet<RawEntity>()
        val bob = createPersonEntity("an-id", "bob", 42)
        entityCollection.applyOperation(CrdtSet.Operation.Add(VersionMap("me" to 1), "me", bob))

        var sentSyncRequest = false
        val job = Job(coroutineContext[Job.Key])
        var id: Int = -1
        id = activeStore.on(ProxyCallback {
            if (it is ProxyMessage.Operations) {
                assertThat(sentSyncRequest).isFalse()
                sentSyncRequest = true
                activeStore.onProxyMessage(ProxyMessage.SyncRequest(id))
                return@ProxyCallback true
            }

            assertThat(sentSyncRequest).isTrue()
            if (it is ProxyMessage.ModelUpdate) {
                it.model.values.assertEquals(entityCollection.data.values)
                job.complete()
                return@ProxyCallback true
            }
            return@ProxyCallback false
        })

        activeStore.onProxyMessage(
            ProxyMessage.Operations(
                listOf(RefModeStoreOp.SetAdd("me", VersionMap("me" to 1), bob)),
                // Use +1 because we don't want the activeStore to omit sending to our callback
                // (which should have id=1)
                id = id + 1
            )
        )
        job.join()
    }

    @Test
    fun onlySendsModelResponse_toRequestingProxy() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        val job = Job(coroutineContext[Job.Key])
        // requesting store
        val id1 = activeStore.on(ProxyCallback {
            assertThat(it is ProxyMessage.ModelUpdate).isTrue()
            job.complete()
            true
        })

        // another store
        var calledStore2 = false
        activeStore.on(ProxyCallback {
            calledStore2 = true
            true
        })

        activeStore.onProxyMessage(ProxyMessage.SyncRequest(id = id1))
        job.join()
        assertThat(calledStore2).isFalse()
    }

    @Test
    fun propagatesUpdates_fromDrivers_toProxies() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        val bobCollection = CrdtSet<RawEntity>()
        val bob = createPersonEntity("an-id", "bob", 42)
        bobCollection.applyOperation(CrdtSet.Operation.Add(VersionMap("me" to 1), "me", bob))

        val referenceCollection = CrdtSet<Reference>()
        val bobRef = bob.toReference(activeStore.backingStore.storageKey, VersionMap("me" to 1))
        referenceCollection.applyOperation(
            CrdtSet.Operation.Add(VersionMap("me" to 1), "me", bobRef)
        )

        val bobCrdt = createPersonEntityCrdt()
        val actor = activeStore.crdtKey
        bobCrdt.applyOperation(
                CrdtEntity.Operation.SetSingleton(
                actor,
                VersionMap(actor to 1),
                "name",
                CrdtEntity.Reference.buildReference("bob".toReferencable())
            )
        )
        bobCrdt.applyOperation(
            CrdtEntity.Operation.SetSingleton(
                actor,
                VersionMap(actor to 1),
                "age",
                CrdtEntity.Reference.buildReference(42.toReferencable())
            )
        )

        activeStore.backingStore
            .onProxyMessage(ProxyMessage.ModelUpdate(bobCrdt.data, id = 1), "an-id")

        var id = -1
        val job = Job(coroutineContext[Job.Key])
        id = activeStore.on(ProxyCallback {
            if (it is ProxyMessage.ModelUpdate) {
                assertThat(it.id).isEqualTo(id)
                it.model.values.assertEquals(bobCollection.data.values)
                job.complete()
                return@ProxyCallback true
            }
            job.completeExceptionally(AssertionError("Should have received model update."))
        })

        val driver = activeStore.containerStore.driver as MockDriver<CrdtSet.Data<Reference>>
        driver.receiver!!(referenceCollection.data, 1)
        job.join()
    }

    @Ignore("This test can be enabled when we output operations from collection model merges")
    @Test
    fun wontSendAnUpdate_toDriver_afterDriverOriginatedMessages() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        val referenceCollection = CrdtSet<Reference>()
        val reference = Reference("an-id", MockHierarchicalStorageKey(), VersionMap("me" to 1))
        referenceCollection.applyOperation(
            CrdtSet.Operation.Add(VersionMap("me" to 1), "me", reference)
        )

        val driver = activeStore.containerStore.driver as MockDriver<CrdtSet.Data<Reference>>

        driver.receiver!!(referenceCollection.data, 1)

        assertThat(driver.sentData).isEmpty()
    }

    @Test
    fun resendsFailedDriverUpdates_afterMerging() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        // local model from proxy.
        val bobCollection = CrdtSet<RawEntity>()
        val bob = createPersonEntity("an-id", "bob", 42)
        bobCollection.applyOperation(CrdtSet.Operation.Add(VersionMap("me" to 1), "me", bob))

        // conflicting remote count from store
        val remoteCollection = CrdtSet<Reference>()
        val reference =
            Reference("another-id", MockHierarchicalStorageKey(), VersionMap("them" to 1))
        remoteCollection.applyOperation(
            CrdtSet.Operation.Add(VersionMap("them" to 1), "them", reference)
        )

        // Ensure remote entity is stored in backing store.
        activeStore.backingStore.onProxyMessage(
            ProxyMessage.ModelUpdate(createPersonEntityCrdt().data, id = 2),
            "another-id"
        )

        val driver = activeStore.containerStore.driver as MockDriver<CrdtSet.Data<Reference>>
        driver.fail = true // make sending return false

        assertThat(
            activeStore.onProxyMessage(
                ProxyMessage.ModelUpdate(RefModeStoreData.Set(bobCollection.data), id = 1)
            )
        ).isTrue()
        assertThat(driver.sentData).isNotEmpty() // send should've been called.

        driver.fail = false // make sending work.

        driver.receiver!!(remoteCollection.data, 1)
        assertThat(driver.sentData).hasSize(2) // send should've been called again

        val actor = activeStore.crdtKey
        val ref2 = Reference("an-id", MockHierarchicalStorageKey(), VersionMap(actor to 1))
        remoteCollection.applyOperation(CrdtSet.Operation.Add(VersionMap("me" to 1), "me", ref2))
        assertThat(driver.sentData.last()).isEqualTo(remoteCollection.data)
    }

    @Test
    fun resolvesACombination_ofMessages_fromProxy_andDriver() = runBlockingTest {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()

        val driver = activeStore.containerStore.driver as MockDriver<CrdtSet.Data<Reference>>

        val e1 = createPersonEntity("e1", "e1", 1)
        val e2 = createPersonEntity("e2", "e2", 2)
        val e3 = createPersonEntity("e3", "e3", 3)

        activeStore.onProxyMessage(
            ProxyMessage.Operations(
                listOf(RefModeStoreOp.SetAdd("me", VersionMap("me" to 1), e1)),
                id = 1
            )
        )
        activeStore.onProxyMessage(
            ProxyMessage.Operations(
                listOf(RefModeStoreOp.SetAdd("me", VersionMap("me" to 2), e2)),
                id = 1
            )
        )
        activeStore.onProxyMessage(
            ProxyMessage.Operations(
                listOf(RefModeStoreOp.SetAdd("me", VersionMap("me" to 3), e3)),
                id = 1
            )
        )

        val e1Ref = CrdtSet.DataValue(
            VersionMap("me" to 1),
            Reference("e1", MockHierarchicalStorageKey(), VersionMap())
        )
        val t1Ref = CrdtSet.DataValue(
            VersionMap("me" to 1, "them" to 1),
            Reference("t1", MockHierarchicalStorageKey(), VersionMap())
        )
        val t2Ref = CrdtSet.DataValue(
            VersionMap("me" to 1, "them" to 2),
            Reference("t2", MockHierarchicalStorageKey(), VersionMap())
        )

        driver.receiver!!(
            CrdtSet.DataImpl(
                VersionMap("me" to 1, "them" to 1),
                mutableMapOf(
                    "e1" to e1Ref,
                    "t1" to t1Ref
                )
            ),
            1
        )
        driver.receiver!!(
            CrdtSet.DataImpl(
                VersionMap("me" to 1, "them" to 2),
                mutableMapOf(
                    "e1" to e1Ref,
                    "t1" to t1Ref,
                    "t2" to t2Ref
                )
            ),
            2
        )

        activeStore.idle()

        assertThat(activeStore.containerStore.getLocalData())
            .isEqualTo(driver.sentData.last())
    }

    @Test
    fun holdsOnto_containerUpdate_untilBackingDataArrives() = runBlocking {
        DriverFactory.register(MockDriverProvider())

        val activeStore = createReferenceModeStore()
        val actor = activeStore.crdtKey

        val referenceCollection = CrdtSet<Reference>()
        val ref = Reference("an-id", MockHierarchicalStorageKey(), VersionMap(actor to 1))
        referenceCollection.applyOperation(CrdtSet.Operation.Add(VersionMap("me" to 1), "me", ref))

        val job = Job(coroutineContext[Job.Key])
        var backingStoreSent = false
        val id = activeStore.on(ProxyCallback {
            if (!backingStoreSent) {
                job.completeExceptionally(
                    AssertionError("Backing store data should've been sent first.")
                )
            }
            if (it is ProxyMessage.ModelUpdate) {
                val entityRecord = requireNotNull(it.model.values["an-id"]?.value)
                assertThat(entityRecord.singletons["name"]?.id)
                    .isEqualTo("bob".toReferencable().id)
                assertThat(entityRecord.singletons["age"]?.id)
                    .isEqualTo(42.toReferencable().id)
                job.complete()
            } else {
                job.completeExceptionally(AssertionError("Invalid ProxyMessage type received"))
            }
            true
        })

        val containerJob = launch {
            activeStore.containerStore.onReceive(referenceCollection.data, id + 1)
        }

        backingStoreSent = true

        val entityCrdt = createPersonEntityCrdt()
        entityCrdt.applyOperation(
            CrdtEntity.Operation.SetSingleton(
                actor,
                VersionMap(actor to 1),
                "name",
                CrdtEntity.Reference.buildReference("bob".toReferencable())
            )
        )
        entityCrdt.applyOperation(
            CrdtEntity.Operation.SetSingleton(
                actor,
                VersionMap(actor to 1),
                "age",
                CrdtEntity.Reference.buildReference(42.toReferencable())
            )
        )

        val backingStore = activeStore.backingStore.stores["an-id"]
            ?: activeStore.backingStore.setupStore("an-id")
        backingStore.store.onReceive(entityCrdt.data, id + 2)

        activeStore.idle()

        job.join()
        containerJob.join()
    }

    // region Helpers

    private fun BackingStore.getEntityDriver(id: ReferenceId): MockDriver<CrdtEntity.Data> =
        requireNotNull(stores[id]).store.driver as MockDriver<CrdtEntity.Data>

    private suspend fun createReferenceModeStore(): ReferenceModeStore {
        return ReferenceModeStore.CONSTRUCTOR(
            StoreOptions<RefModeStoreData, RefModeStoreOp, RefModeStoreOutput>(
                testKey,
                ExistenceCriteria.ShouldCreate,
                CollectionType(EntityType(schema)),
                StorageMode.ReferenceMode
            )
        ) as ReferenceModeStore
    }

    private fun createPersonEntity(id: ReferenceId, name: String, age: Int): RawEntity = RawEntity(
        id = id,
        singletons = mapOf(
            "name" to name.toReferencable(),
            "age" to age.toReferencable()
        )
    )

    private fun createPersonEntityCrdt(): CrdtEntity = CrdtEntity(
        VersionMap(),
        RawEntity(singletonFields = setOf("name", "age"))
    )

    /**
     * Asserts that the receiving map of entities (values from a CrdtSet/CrdtSingleton) are equal to
     * the [other] map of entities, on an ID-basis.
     */
    private fun Map<ReferenceId, CrdtSet.DataValue<RawEntity>>.assertEquals(
        other: Map<ReferenceId, CrdtSet.DataValue<RawEntity>>
    ) {
        assertThat(keys).isEqualTo(other.keys)
        forEach { (refId, myEntity) ->
            val otherEntity = requireNotNull(other[refId])
            // Should have same fields.
            assertThat(myEntity.value.singletons.keys)
                .isEqualTo(otherEntity.value.singletons.keys)
            assertThat(myEntity.value.collections.keys)
                .isEqualTo(otherEntity.value.collections.keys)

            myEntity.value.singletons.forEach { (field, value) ->
                val otherValue = otherEntity.value.singletons[field]
                assertThat(value?.id).isEqualTo(otherValue?.id)
            }
            myEntity.value.collections.forEach { (field, value) ->
                val otherValue = otherEntity.value.collections[field]
                assertThat(value.size).isEqualTo(otherValue?.size)
                assertThat(value.map { it.id }.toSet())
                    .isEqualTo(otherValue?.map { it.id }?.toSet())
            }
        }
    }

    // endregion

    // region Mocks

    private data class MockHierarchicalStorageKey(
        private val segment: String = ""
    ) : StorageKey("testing-hierarchy") {
        override fun toKeyString(): String = segment

        override fun childKeyWithComponent(component: String): StorageKey =
            MockHierarchicalStorageKey("$segment$component")
    }

    private class MockDriverProvider : DriverProvider {
        override fun willSupport(storageKey: StorageKey): Boolean = true

        override suspend fun <Data : Any> getDriver(
            storageKey: StorageKey,
            existenceCriteria: ExistenceCriteria
        ): Driver<Data> = MockDriver<Data>(storageKey, existenceCriteria)
    }

    private class MockDriver<T : Any>(
        override val storageKey: StorageKey,
        override val existenceCriteria: ExistenceCriteria
    ) : Driver<T> {
        override var token: String? = null
        var receiver: (suspend (data: T, version: Int) -> Unit)? = null
        var sentData = mutableListOf<T>()
        var fail = false

        override suspend fun registerReceiver(
            token: String?,
            receiver: suspend (data: T, version: Int) -> Unit
        ) {
            this.token = token
            this.receiver = receiver
        }

        override suspend fun send(data: T, version: Int): Boolean {
            sentData.add(data)
            return !fail
        }
    }

    // endregion
}