import BarkDomain
import MapKit

/// Native completion/resolution boundary. Each request owns its delegate, timeout and cancellation.
@MainActor struct MapSearchClient {
    struct Suggestion: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        var completion: MKLocalSearchCompletion? = nil
        var coordinate: Coordinate? = nil
        var region: MKCoordinateRegion? = nil
    }
    struct Place {
        let stop: Trip.Stop
        let subtitle: String
    }
    var suggestions: @MainActor (String, MKCoordinateRegion?) async throws -> [Suggestion]
    var resolve: @MainActor (Suggestion) async throws -> Place

    static let unavailable = Self(suggestions: { _, _ in [] }, resolve: { _ in throw CancellationError() })
    static let live = Self(
        suggestions: { query, region in
            let request = CompletionRequest(query: query, region: region)
            let results = try await request.results()
            // Full phrases may resolve even when Apple's autocomplete returns no suggestions.
            return results.isEmpty
                ? [.init(id: "query:" + query, title: query, subtitle: "Search Apple Maps", region: region)]
                : results
        },
        resolve: { suggestion in
            let search = SearchRequest(suggestion: suggestion)
            let timeout = Task { @MainActor in
                do {
                    try await Task.sleep(for: .seconds(15))
                    search.cancel()
                } catch {}
            }
            defer { timeout.cancel() }
            let result = try await withTaskCancellationHandler {
                try Task.checkCancellation()
                return try await search.value.start()
            } onCancel: {
                Task { @MainActor in search.cancel() }
            }
            try Task.checkCancellation()
            guard let item = result.mapItems.first else { throw URLError(.badServerResponse) }
            let point: CLLocationCoordinate2D
            let subtitle: String
            let locality: String?
            if #available(iOS 26, *) {
                point = item.location.coordinate
                subtitle =
                    item.addressRepresentations?.fullAddress(includingRegion: true, singleLine: true)
                    ?? suggestion.subtitle
                locality = item.addressRepresentations?.cityWithContext
            } else {
                point = item.placemark.coordinate
                subtitle = item.placemark.title ?? suggestion.subtitle
                locality = [item.placemark.locality, item.placemark.administrativeArea].compactMap { $0 }
                    .joined(separator: ", ")
            }
            guard let coordinate = Coordinate(latitude: point.latitude, longitude: point.longitude) else {
                throw URLError(.badServerResponse)
            }
            var name = item.name ?? suggestion.title
            while name.utf16.count > 300 { name.removeLast() }
            var stop = Trip.Stop(name: name, coordinate: coordinate)
            if let id = item.identifier?.rawValue { stop.placeIdentity = .provider(name: "apple", id: id) }
            if let locality { stop.state = locality }
            return Place(stop: stop, subtitle: subtitle)
        })

    private final class SearchRequest {
        let value: MKLocalSearch
        init(suggestion: Suggestion) {
            let request: MKLocalSearch.Request
            if let completion = suggestion.completion {
                request = .init(completion: completion)
            } else {
                request = .init()
                request.naturalLanguageQuery = suggestion.title
                if let region = suggestion.region { request.region = region }
            }
            value = MKLocalSearch(request: request)
        }
        func cancel() { value.cancel() }
    }
    private final class CompletionRequest: NSObject, MKLocalSearchCompleterDelegate {
        private let completer = MKLocalSearchCompleter()
        private let query: String
        private var continuation: CheckedContinuation<[Suggestion], any Error>?
        init(query: String, region: MKCoordinateRegion?) {
            self.query = query
            super.init()
            completer.resultTypes = [.address, .pointOfInterest]
            completer.regionPriority = .default
            if let region { completer.region = region }
        }
        func results() async throws -> [Suggestion] {
            let timeout = Task { @MainActor in
                do {
                    try await Task.sleep(for: .seconds(12))
                    finish(.failure(URLError(.timedOut)))
                } catch {}
            }
            defer { timeout.cancel() }
            return try await withTaskCancellationHandler {
                try Task.checkCancellation()
                return try await withCheckedThrowingContinuation { continuation in
                    self.continuation = continuation
                    completer.delegate = self
                    completer.queryFragment = query
                }
            } onCancel: {
                Task { @MainActor in self.finish(.failure(CancellationError())) }
            }
        }
        func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
            var ids = Set<String>()
            let results = completer.results.prefix(15).compactMap { completion -> Suggestion? in
                let id = completion.title + "|" + completion.subtitle
                guard ids.insert(id).inserted else { return nil }
                return Suggestion(
                    id: id, title: completion.title, subtitle: completion.subtitle,
                    completion: completion)
            }
            finish(.success(results))
        }
        func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: any Error) {
            finish(.failure(error))
        }
        private func finish(_ result: Result<[Suggestion], any Error>) {
            let pending = continuation
            continuation = nil
            completer.delegate = nil
            completer.cancel()
            pending?.resume(with: result)
        }
    }
}
