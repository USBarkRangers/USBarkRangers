import BarkDomain
import Foundation
import MapKit
import Observation

/// Account-scoped local pin projection and one serialized disk action. No cloud or trip writes.
/// Future saved-place notes/journal UI should reuse this storage boundary, not add another map draft.
@MainActor @Observable final class SavedPlacesModel {
    private var visiblePlaces: [String: SavedPlaceIndex.Pin] = [:]
    var places: [String: SavedPlaceIndex.Pin] { currentScope ? visiblePlaces : [:] }
    private var visibleSelection: SavedPlace?
    var selected: SavedPlace? { currentScope ? visibleSelection : nil }
    private var readySelection = false
    var selectionReady: Bool { currentScope && readySelection }
    private var ready = false
    var isReady: Bool { currentScope && ready }
    private var workingScope: UUID?
    var isWorking: Bool { workingScope == scopeGeneration }
    private(set) var message: String?
    private let rootStore: SavedPlaceStore
    private var store: SavedPlaceStore
    private let account: AccountSession?
    private var ownerUID: String?
    private var bound = false
    private var scopeGeneration = UUID()
    private var currentScope: Bool { account == nil || (bound && ownerUID == account?.identity?.uid) }
    private var task: Task<Void, Never>?
    private var query: Task<Void, Never>?
    private var selection: Task<Void, Never>?
    private var region: SavedPlaceIndex.Region?
    private var retainedStops: [Trip.Stop] = []
    private var selectedIdentity: String?
    private var generation = UUID()
    init(store: SavedPlaceStore, account: AccountSession? = nil) {
        rootStore = store
        self.store = store
        self.account = account
        if account != nil { bindAccount() }
    }

    private func bindAccount() {
        let uid = withObservationTracking {
            account?.identity?.uid
        } onChange: { [weak self] in
            Task { @MainActor in self?.bindAccount() }
        }
        guard !bound || uid != ownerUID else { return }
        bound = true
        ownerUID = uid
        scopeGeneration = UUID()
        query?.cancel()
        selection?.cancel()
        visiblePlaces = [:]
        visibleSelection = nil
        selectedIdentity = nil
        readySelection = false
        ready = false
        message = nil
        store = rootStore.scoped(
            project: account?.nativeProfileConfiguration?.project ?? "bark-ranger-ios", uid: uid)
        load()
    }

    func load() {
        guard !isReady, !isWorking else { return }
        perform(failure: "Saved places could not be opened. Try again; your files have been kept.") {
            try await $0.prepare()
        }
    }
    func saved(_ stop: Trip.Stop) -> SavedPlaceIndex.Pin? {
        places.values.first { $0.stop.placeIdentity == stop.placeIdentity }
    }
    func isSelectedPlaceReady(_ stop: Trip.Stop) -> Bool {
        selectionReady && selectedIdentity == stop.placeIdentity.storageID
    }
    func select(_ stop: Trip.Stop) {
        let id = stop.placeIdentity.storageID
        guard selectedIdentity != id || !selectionReady else { return }
        selectedIdentity = id
        visibleSelection = nil
        readySelection = false
        selection?.cancel()
        let store = store
        let scope = scopeGeneration
        selection = Task {
            do {
                let saved = try await store.saved(stop)
                guard !Task.isCancelled, self.scopeGeneration == scope, self.selectedIdentity == id else {
                    return
                }
                self.visibleSelection = saved
                self.readySelection = true
            } catch {
                if !Task.isCancelled {
                    self.message = "This saved place could not be read. Its file is retained."
                }
            }
        }
    }
    func viewport(_ value: MKCoordinateRegion, including stops: [Trip.Stop]) {
        let next = SavedPlaceIndex.Region(
            latitude: value.center.latitude, longitude: value.center.longitude,
            latitudeDelta: value.span.latitudeDelta, longitudeDelta: value.span.longitudeDelta)
        // Indexed point retention depends only on identity, not notes, time edits,
        // duplicate trip occurrences or geometry already owned by routing.
        let identities = Set(stops.filter { $0.parkID == nil }.map(\.placeIdentity))
        guard next != region || identities != Set(retainedStops.map(\.placeIdentity)) else { return }
        region = next
        retainedStops = identities.map {
            Trip.Stop(
                id: $0.storageID, placeIdentity: $0,
                name: "", coordinate: nil)
        }
        refreshPins()
    }
    private func refreshPins() {
        guard let region else { return }
        generation = UUID()
        let generation = generation
        let stops = retainedStops
        query?.cancel()
        let store = store
        let scope = scopeGeneration
        query = Task {
            do {
                try await Task.sleep(for: .milliseconds(100))
                let pins = try await store.pins(in: region, including: stops)
                guard !Task.isCancelled, self.scopeGeneration == scope, self.generation == generation else {
                    return
                }
                self.visiblePlaces = pins
                self.ready = true
            } catch {
                if !Task.isCancelled {
                    self.message = "Saved pins could not be loaded. Your files are retained."
                }
            }
        }
    }
    func save(_ place: SavedPlace) {
        perform(failure: "This place could not be saved. Check available storage and try again.") { store in
            let saved = try await store.save(place)
            guard self.store === store, self.currentScope else { return }
            if self.selectedIdentity == saved.stop.placeIdentity.storageID {
                self.selection?.cancel()
                self.visibleSelection = saved
                self.readySelection = true
            }
        }
    }
    func remove(_ place: SavedPlace, completed: @escaping () -> Void) {
        perform(failure: "This place could not be removed. Try again.", completed: completed) { store in
            try await store.remove(place.id)
            guard self.store === store, self.currentScope else { return }
            self.visiblePlaces.removeValue(forKey: place.id)
            if self.selectedIdentity == place.stop.placeIdentity.storageID {
                self.selection?.cancel()
                self.visibleSelection = nil
                self.readySelection = true
            }
        }
    }
    func dismissMessage() { message = nil }
    func waitForPending() async {
        await task?.value
        await query?.value
        await selection?.value
    }

    private func perform(
        failure: String, completed: @escaping () -> Void = {},
        work: @escaping (SavedPlaceStore) async throws -> Void
    ) {
        guard !isWorking, currentScope else { return }
        let scope = scopeGeneration
        workingScope = scope
        message = nil
        let store = store
        let previous = task
        // Finish accepted old-account disk writes against their captured writer,
        // but never publish their results into the next account's presentation.
        task = Task {
            await previous?.value
            defer {
                if scopeGeneration == scope {
                    task = nil
                    workingScope = nil
                }
            }
            do {
                try await work(store)
                guard scopeGeneration == scope, currentScope else { return }
                ready = true
                refreshPins()
                completed()
            } catch {
                if scopeGeneration == scope, currentScope { message = failure }
            }
        }
    }
}
