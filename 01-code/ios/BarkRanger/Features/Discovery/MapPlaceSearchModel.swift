import BarkDomain
import MapKit
import Observation

/// Temporary place suggestions only. The map's existing query and detail selection remain authoritative.
@MainActor @Observable final class MapPlaceSearchModel {
    private(set) var suggestions: [MapSearchClient.Suggestion] = []
    private(set) var isSearching = false
    private(set) var isResolving = false
    private(set) var notice: String?
    private let client: MapSearchClient
    private let delay: Duration
    private var input: String?
    private var generation = UUID()
    private var task: Task<Void, Never>?

    init(client: MapSearchClient, delay: Duration = .milliseconds(250)) {
        self.client = client
        self.delay = delay
    }
    func update(query: String, region: MKCoordinateRegion?, permitted: Bool, connected: Bool) {
        let query = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        let key = "\(permitted)|\(connected)|\(query)"
        guard input != key else { return }
        cancel()
        input = key
        guard query.count >= 2 else { return }
        if let coordinate = Self.coordinate(query) {
            suggestions = [
                .init(
                    id: "coordinate:" + query, title: query,
                    subtitle: "Custom coordinates", coordinate: coordinate)
            ]
            return
        }
        guard permitted else {
            notice = "Premium enables online place search."
            return
        }
        guard connected else {
            notice = "Connect to search Apple Maps. BARK parks remain available."
            return
        }
        let generation = generation
        isSearching = true
        task = Task {
            do {
                try await Task.sleep(for: delay)
                let results = try await client.suggestions(query, region)
                guard !Task.isCancelled, self.generation == generation else { return }
                suggestions = results
                notice = results.isEmpty ? "No places found. Try a town and state." : nil
            } catch {
                if !Task.isCancelled, self.generation == generation {
                    notice = "Apple Maps search is unavailable. BARK park search still works."
                }
            }
            if self.generation == generation {
                isSearching = false
                task = nil
            }
        }
    }
    func select(
        _ suggestion: MapSearchClient.Suggestion, completed: @escaping (MapSearchClient.Place) -> Void
    ) {
        guard suggestions.contains(where: { $0.id == suggestion.id }), !isResolving else { return }
        task?.cancel()
        generation = UUID()
        let generation = generation
        isSearching = false
        isResolving = true
        notice = nil
        task = Task {
            do {
                let place: MapSearchClient.Place
                if let coordinate = suggestion.coordinate {
                    place = .init(
                        stop: .init(name: suggestion.title, coordinate: coordinate),
                        subtitle: "Custom coordinates")
                } else {
                    place = try await client.resolve(suggestion)
                }
                guard !Task.isCancelled, self.generation == generation else { return }
                isResolving = false
                task = nil
                completed(place)
            } catch {
                if !Task.isCancelled, self.generation == generation {
                    notice = "This place could not be opened. Please try again."
                    isResolving = false
                    task = nil
                }
            }
        }
    }
    func cancel() {
        generation = UUID()
        task?.cancel()
        task = nil
        input = nil
        suggestions = []
        notice = nil
        isSearching = false
        isResolving = false
    }
    private static func coordinate(_ text: String) -> Coordinate? {
        let parts = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 2, let latitude = Double(parts[0]), let longitude = Double(parts[1]) else {
            return nil
        }
        return Coordinate(latitude: latitude, longitude: longitude)
    }
}
