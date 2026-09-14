import BarkDomain
import Foundation
import Observation

/// Owns one user-requested location lookup, never tracking or state/achievement storage.
@MainActor @Observable final class NearbyStatesModel {
    private(set) var reference: Coordinate?
    private(set) var notice: String?
    private(set) var loading = false
    private let locate: @MainActor () async throws -> Coordinate
    private let mapCenter: @MainActor () -> Coordinate?
    private var task: Task<Void, Never>?
    private var locatedAt: Date?
    private var generation = UUID()

    init(
        locate: @escaping @MainActor () async throws -> Coordinate = {
            throw LocationClient.Failure.unavailable
        },
        mapCenter: @escaping @MainActor () -> Coordinate? = { nil }
    ) {
        self.locate = locate
        self.mapCenter = mapCenter
    }

    func load() {
        guard task == nil, locatedAt.map({ Date().timeIntervalSince($0) >= 60 }) ?? true else { return }
        reference = mapCenter()
        notice = reference == nil ? nil : "Using your saved map area while finding nearby states."
        loading = true
        let generation = generation
        task = Task {
            defer {
                if self.generation == generation {
                    loading = false
                    task = nil
                }
            }
            do {
                try Task.checkCancellation()
                let coordinate = try await locate()
                guard !Task.isCancelled, self.generation == generation else { return }
                reference = coordinate
                locatedAt = Date()
                notice = nil
            } catch {
                guard !Task.isCancelled, self.generation == generation else { return }
                notice =
                    reference == nil
                    ? "Location unavailable. Completed states appear first, followed by state name."
                    : "Location unavailable. Nearby states are ordered from your saved map area."
            }
        }
    }

    func reset() {
        generation = UUID()
        task?.cancel()
        task = nil
        reference = nil
        notice = nil
        locatedAt = nil
        loading = false
    }
}
