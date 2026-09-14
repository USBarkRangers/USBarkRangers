import BarkDomain
import Foundation
import MapKit
import Observation

/// Read-only UI projection of SavedPlaceStore and one serialized local action. No trip/account access.
/// Future saved-place notes/journal UI should reuse this storage boundary, not add another map draft.
@MainActor @Observable final class SavedPlacesModel {
    private(set) var places: [String: SavedPlaceIndex.Pin] = [:]
    private(set) var selected: SavedPlace?
    private(set) var selectionReady = false
    private(set) var isReady = false
    private(set) var isWorking = false
    private(set) var message: String?
    private let store: SavedPlaceStore
    private var task: Task<Void, Never>?
    private var query: Task<Void, Never>?
    private var selection: Task<Void, Never>?
    private var region: SavedPlaceIndex.Region?
    private var retainedStops: [Trip.Stop] = []
    private var selectedIdentity: String?
    private var generation = UUID()
    init(store: SavedPlaceStore) { self.store = store }

    func load() {
        guard !isReady, !isWorking else { return }
        perform(failure: "Saved places could not be opened. Try again; your files have been kept.") {
            try await self.store.prepare()
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
        selected = nil
        selectionReady = false
        selection?.cancel()
        selection = Task {
            do {
                let saved = try await self.store.saved(stop)
                guard !Task.isCancelled, self.selectedIdentity == id else { return }
                self.selected = saved
                self.selectionReady = true
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
        query = Task {
            do {
                try await Task.sleep(for: .milliseconds(100))
                let pins = try await self.store.pins(in: region, including: stops)
                guard !Task.isCancelled, self.generation == generation else { return }
                self.places = pins
                self.isReady = true
            } catch {
                if !Task.isCancelled {
                    self.message = "Saved pins could not be loaded. Your files are retained."
                }
            }
        }
    }
    func save(_ place: SavedPlace) {
        perform(failure: "This place could not be saved. Check available storage and try again.") {
            let saved = try await self.store.save(place)
            if self.selectedIdentity == saved.stop.placeIdentity.storageID {
                self.selection?.cancel()
                self.selected = saved
                self.selectionReady = true
            }
        }
    }
    func remove(_ place: SavedPlace, completed: @escaping () -> Void) {
        perform(failure: "This place could not be removed. Try again.", completed: completed) {
            try await self.store.remove(place.id)
            self.places.removeValue(forKey: place.id)
            if self.selectedIdentity == place.stop.placeIdentity.storageID {
                self.selection?.cancel()
                self.selected = nil
                self.selectionReady = true
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
        work: @escaping () async throws -> Void
    ) {
        guard !isWorking else { return }
        isWorking = true
        message = nil
        // An accepted device write finishes even if the sheet closes or the account changes.
        // The app owns this task; lifecycle/test teardown can await it before deleting a sandbox.
        task = Task {
            defer {
                task = nil
                isWorking = false
            }
            do {
                try await work()
                isReady = true
                refreshPins()
                completed()
            } catch { message = failure }
        }
    }
}
