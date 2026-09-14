import BarkDomain
import MapKit

/// One route lookup path: memory → account-scoped device cache → Apple directions.
@MainActor final class RoutePreviewService {
    private final class Request {
        let value: MKDirections
        init(_ request: MKDirections.Request) { value = MKDirections(request: request) }
        func cancel() { value.cancel() }
    }
    enum Failure: Error { case invalidStop, unavailable }
    private let calculate: @MainActor (TripRoutePlan.Segment) async throws -> MKRoute
    private let now: () -> Date
    private let lifetime: TimeInterval
    private let store: RouteGeometryStore?
    private let maximumMemoryBytes: Int
    private var scope: String?
    private var generation = UUID()
    init(
        calculate: @escaping @MainActor (TripRoutePlan.Segment) async throws -> MKRoute = RoutePreviewService
            .request,
        now: @escaping () -> Date = Date.init, lifetime: TimeInterval = RoadRoute.Snapshot.lifetime,
        store: RouteGeometryStore? = nil, maximumMemoryBytes: Int = 8 * 1024 * 1024
    ) {
        self.calculate = calculate
        self.now = now
        self.lifetime = lifetime
        self.store = store
        self.maximumMemoryBytes = maximumMemoryBytes
    }
    private struct Entry {
        let route: RoadRoute
        var access: UInt64
    }
    private var cache: [String: Entry] = [:]
    private var access: UInt64 = 0
    private var memoryBytes = 0
    private var sweptAt: Date?

    func isCurrent(_ route: RoadRoute) -> Bool {
        guard let date = route.fetchedAt else { return true }
        let age = now().timeIntervalSince(date)
        return age >= 0 && age < lifetime
    }
    func cachedRoute(_ segment: TripRoutePlan.Segment) -> RoadRoute? {
        if sweptAt.map({ now().timeIntervalSince($0) >= 3600 }) ?? true {
            for (key, entry) in cache where !isCurrent(entry.route) { remove(key) }
            sweptAt = now()
        }
        guard let route = cache[segment.geometryKey]?.route else { return nil }
        guard isCurrent(route) else {
            remove(segment.geometryKey)
            return nil
        }
        access &+= 1
        cache[segment.geometryKey]?.access = access
        return route
    }
    /// Batch restore precedes the paced network worker, including when offline or read-only.
    func restore(_ segments: [TripRoutePlan.Segment]) async -> [String: RoadRoute] {
        guard let store, let scope, !segments.isEmpty else { return [:] }
        let generation = generation
        let snapshots = await store.load(keys: segments.map(Self.diskKey), scope: scope, now: now())
        guard !Task.isCancelled, self.generation == generation else { return [:] }
        var result: [String: RoadRoute] = [:]
        for (index, segment) in segments.enumerated() where result[segment.geometryKey] == nil {
            if index.isMultiple(of: 32) {
                await Task.yield()
                guard !Task.isCancelled, self.generation == generation else { return [:] }
            }
            if let snapshot = snapshots[Self.diskKey(segment)] {
                let route = RoadRoute(snapshot)
                guard isCurrent(route) else { continue }
                remember(route, key: segment.geometryKey)
                result[segment.geometryKey] = route
            }
        }
        return result
    }
    func route(_ segment: TripRoutePlan.Segment) async throws -> RoadRoute {
        try Task.checkCancellation()
        if let route = cachedRoute(segment) { return route }
        let generation = generation
        // DayRouteService already batch-restores; standalone callers use the same disk-first path.
        if let route = await restore([segment])[segment.geometryKey] { return route }
        try Task.checkCancellation()
        guard self.generation == generation else { throw CancellationError() }
        let response = try await calculate(segment)
        let route = RoadRoute(response, fetchedAt: now())
        try Task.checkCancellation()
        guard self.generation == generation else { throw CancellationError() }
        if let store, let scope, let snapshot = route.snapshot {
            await store.save(snapshot, key: Self.diskKey(segment), scope: scope, now: now())
        }
        try Task.checkCancellation()
        guard self.generation == generation else { throw CancellationError() }
        remember(route, key: segment.geometryKey)
        return route
    }
    private static func diskKey(_ segment: TripRoutePlan.Segment) -> String {
        // Version the fixed driving options; future avoid-tolls/etc must become part of this key.
        "driving-v1|\(segment.geometryKey)"
    }
    private func remember(_ route: RoadRoute, key: String) {
        remove(key)
        access &+= 1
        cache[key] = Entry(route: route, access: access)
        memoryBytes += route.memoryBytes
        while memoryBytes > maximumMemoryBytes || cache.count > 5_000 {
            guard let oldest = cache.min(by: { $0.value.access < $1.value.access })?.key else { break }
            remove(oldest)
        }
    }
    private func remove(_ key: String) {
        memoryBytes -= cache.removeValue(forKey: key)?.route.memoryBytes ?? 0
    }
    private static func request(_ segment: TripRoutePlan.Segment) async throws -> MKRoute {
        guard let from = segment.from.coordinate, let to = segment.to.coordinate else {
            throw Failure.invalidStop
        }
        let request = MKDirections.Request()
        request.source = MKMapItem.barkStop(from)
        request.destination = MKMapItem.barkStop(to)
        request.transportType = .automobile
        request.requestsAlternateRoutes = false
        let directions = Request(request)
        let timeout = Task { @MainActor in
            do {
                try await Task.sleep(for: .seconds(25))
                directions.cancel()
            } catch {}
        }
        defer { timeout.cancel() }
        let response = try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await directions.value.calculate()
        } onCancel: {
            Task { @MainActor in directions.cancel() }
        }
        try Task.checkCancellation()
        guard let route = response.routes.first else { throw Failure.unavailable }
        return route
    }
    /// Forget rendered/memory state on account changes; retained files stay isolated by account.
    func clear(scope: String? = nil) {
        generation = UUID()
        self.scope = scope
        cache.removeAll()
        memoryBytes = 0
        sweptAt = nil
    }
}
