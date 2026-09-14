import BarkDomain
import MapKit
import Observation

/// Road geometry for one visible itinerary. A single worker requests only missing coordinate pairs.
/// Presentation, notes and selection never invalidate a road leg. The shared app session cancels work in the background.
@MainActor @Observable final class DayRouteService {
    typealias Leg = RoadRoute
    private(set) var tripID: String?
    private(set) var days: [TripRoutePlan.Day] = []
    private(set) var legs: [String: Leg] = [:]
    private(set) var failures: Set<String> = []
    private(set) var geometryVersion: UInt64 = 0
    private(set) var isLoading = false
    private var preferredDay: String?
    private var permitted = false
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private let calculate: @MainActor (TripRoutePlan.Segment) async throws -> Leg
    private let spacing: Duration
    private let clearCache: (String?) -> Void
    private let cached: (TripRoutePlan.Segment) -> Leg?
    private let restore: (([TripRoutePlan.Segment]) async -> [String: Leg])?
    private let isCurrent: (Leg) -> Bool
    private var restoredKeys: Set<String> = []
    private var workKeys: Set<String> = []

    init(service: RoutePreviewService, spacing: Duration = .milliseconds(250)) {
        calculate = { try await service.route($0) }
        self.spacing = spacing
        clearCache = service.clear
        cached = service.cachedRoute
        restore = service.restore
        isCurrent = service.isCurrent
    }
    init(
        spacing: Duration = .zero, calculate: @escaping @MainActor (TripRoutePlan.Segment) async throws -> Leg
    ) {
        self.spacing = spacing
        self.calculate = calculate
        clearCache = { _ in }
        cached = { _ in nil }
        restore = nil
        isCurrent = { _ in true }
    }
    func update(tripID: String, plan: TripRoutePlan, preferredDay: String?, permitted: Bool) {
        if self.tripID != tripID {
            clearTrip()
            self.tripID = tripID
        }
        let oldSignature = signature(days)
        let lostPermission = self.permitted && !permitted
        days = plan.days
        self.preferredDay = preferredDay
        self.permitted = permitted
        let keys = Set(days.flatMap { $0.segments.map(\.geometryKey) })
        let count = legs.count
        legs = legs.filter { keys.contains($0.key) && isCurrent($0.value) }
        let removed = count != legs.count
        var restored = false
        // Restore completed legs before publishing the trip: cache hits never enter the paced worker.
        for segment in days.flatMap(\.segments) where legs[segment.geometryKey] == nil {
            if let leg = cached(segment) {
                legs[segment.geometryKey] = leg
                restored = true
            }
        }
        failures.formIntersection(keys)
        restoredKeys.formIntersection(keys)
        if oldSignature != signature(days) || removed || restored { geometryVersion &+= 1 }
        if lostPermission || (task != nil && workKeys != keys) { pause() }
        startWorker()
    }
    func prioritize(_ id: String) { preferredDay = id }
    func retry() {
        failures.removeAll()
        restoredKeys = Set(legs.keys)
        startWorker()
    }
    func leg(_ segment: TripRoutePlan.Segment) -> Leg? { legs[segment.geometryKey] }
    private func signature(_ days: [TripRoutePlan.Day]) -> [String] {
        days.map {
            "\($0.id)|\($0.color)|" + $0.segments.map { "\($0.id):\($0.geometryKey)" }.joined(separator: "|")
        }
    }
    private func nextSegment() -> TripRoutePlan.Segment? {
        let ordered = days.filter { $0.id == preferredDay } + days.filter { $0.id != preferredDay }
        return ordered.lazy.flatMap(\.segments).first {
            legs[$0.geometryKey] == nil && !failures.contains($0.geometryKey)
        }
    }
    private func startWorker() {
        let missing = (restore == nil ? [] : days.flatMap(\.segments)).filter {
            legs[$0.geometryKey] == nil && !restoredKeys.contains($0.geometryKey)
        }
        guard task == nil, !missing.isEmpty || (permitted && nextSegment() != nil) else { return }
        let generation = generation
        workKeys = Set(days.flatMap { $0.segments.map(\.geometryKey) })
        isLoading = true
        task = Task {
            let saved = await restore?(missing) ?? [:]
            guard !Task.isCancelled, self.generation == generation else { return }
            restoredKeys.formUnion(missing.map(\.geometryKey))
            if !saved.isEmpty {
                legs.merge(saved) { current, _ in current }
                geometryVersion &+= 1
            }
            while permitted, !Task.isCancelled, let segment = nextSegment() {
                let key = segment.geometryKey
                do {
                    let route = try await calculate(segment)
                    try Task.checkCancellation()
                    guard self.generation == generation else { return }
                    if days.contains(where: { $0.segments.contains(where: { $0.geometryKey == key }) }) {
                        legs[key] = route
                        geometryVersion &+= 1
                    }
                } catch {
                    guard !Task.isCancelled, self.generation == generation else { return }
                    failures.insert(key)
                    // MapKit throttling should stop this batch, rather than hammer the remaining days.
                    if let error = error as? MKError, error.code == .loadingThrottled {
                        failures.formUnion(days.flatMap { $0.segments.map(\.geometryKey) })
                        break
                    }
                }
                do { try await Task.sleep(for: spacing) } catch { return }
            }
            guard self.generation == generation else { return }
            task = nil
            isLoading = false
        }
    }
    func suspend() {
        permitted = false
        pause()
    }
    private func pause() {
        generation = UUID()
        task?.cancel()
        task = nil
        isLoading = false
    }
    func reset(scope: String? = nil) {
        clearCache(scope)
        clearTrip()
    }
    /// Trip visibility changes retain both cache tiers; account changes reset their active namespace.
    func clearTrip() {
        pause()
        permitted = false
        tripID = nil
        days = []
        legs = [:]
        failures = []
        restoredKeys = []
        geometryVersion &+= 1
    }
}
