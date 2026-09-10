import BarkDomain
import Foundation

/// Conditional public-asset requests with a whole-body deadline and a streaming byte cap.
nonisolated struct CatalogHTTPClient: Sendable {
    enum Failure: Error {
        case deadline, response, size, unavailable
        case retryAfter(TimeInterval)
    }
    enum ManifestResponse: Sendable {
        case unchanged
        case changed(CatalogManifest, String?)
    }
    let manifestURL: URL
    let session: URLSession

    init(manifestURL: URL, session: URLSession? = nil) {
        self.manifestURL = manifestURL
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.urlCache = nil
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            config.timeoutIntervalForRequest = 10
            config.timeoutIntervalForResource = 12
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
    }
    func fetchManifest(etag: String?, deadline: ContinuousClock.Instant) async throws -> ManifestResponse {
        let (data, response) = try await request(manifestURL, etag: etag, maximum: 16_384, deadline: deadline)
        if response.statusCode == 304 { return .unchanged }
        return .changed(
            try JSONDecoder().decode(CatalogManifest.self, from: data),
            response.value(forHTTPHeaderField: "ETag"))
    }
    func download(_ manifest: CatalogManifest, deadline: ContinuousClock.Instant) async throws -> Data {
        let url = manifestURL.deletingLastPathComponent().appendingPathComponent(manifest.path)
        return try await request(url, maximum: manifest.bytes, deadline: deadline).0
    }
    private func request(_ url: URL, etag: String? = nil, maximum: Int, deadline: ContinuousClock.Instant)
        async throws -> (Data, HTTPURLResponse)
    {
        guard Self.allowedEndpoint(url), url.host == manifestURL.host, url.port == manifestURL.port else {
            throw Failure.response
        }
        return try await withThrowingTaskGroup(of: (Data, HTTPURLResponse).self) { group in
            group.addTask {
                var request = URLRequest(url: url)
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
                let (bytes, rawResponse) = try await session.bytes(for: request, delegate: RejectRedirects())
                guard let response = rawResponse as? HTTPURLResponse, response.url == url else {
                    throw Failure.response
                }
                if [429, 503].contains(response.statusCode) {
                    throw Failure.retryAfter(
                        Self.retryDelay(response.value(forHTTPHeaderField: "Retry-After")))
                }
                guard response.statusCode == 200 || (response.statusCode == 304 && etag != nil) else {
                    throw Failure.response
                }
                if response.statusCode == 304 { return (Data(), response) }
                guard response.mimeType == "application/json", response.expectedContentLength <= maximum
                else { throw Failure.response }
                var data = Data()
                data.reserveCapacity(min(maximum, 65536))
                for try await byte in bytes {
                    try Task.checkCancellation()
                    guard data.count < maximum else { throw Failure.size }
                    data.append(byte)
                }
                return (data, response)
            }
            group.addTask {
                try await ContinuousClock().sleep(until: deadline)
                throw Failure.deadline
            }
            defer { group.cancelAll() }
            guard let result = try await group.next() else { throw Failure.unavailable }
            return result
        }
    }
    static func allowedEndpoint(_ url: URL) -> Bool {
        guard url.host?.isEmpty == false, url.user == nil, url.password == nil, url.query == nil,
            url.fragment == nil
        else { return false }
        if url.scheme == "https" { return true }
        #if DEBUG
            let host = url.host ?? ""
            let octets = host.split(separator: ".").compactMap { Int($0) }
            let privateIPv4 =
                octets.count == 4 && octets.allSatisfy { (0...255).contains($0) }
                && (octets[0] == 10 || (octets[0] == 192 && octets[1] == 168)
                    || (octets[0] == 172 && (16...31).contains(octets[1])))
            return url.scheme == "http" && (["localhost", "127.0.0.1", "::1"].contains(host) || privateIPv4)
        #else
            return false
        #endif
    }
    private static func retryDelay(_ value: String?) -> TimeInterval {
        if let value, let seconds = Double(value), seconds.isFinite { return max(1, min(seconds, 86400)) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        if let value, let date = formatter.date(from: value) {
            return max(1, min(date.timeIntervalSinceNow, 86400))
        }
        return 60
    }
}

/// Public catalog assets have no redirects. Reject before contacting a different endpoint.
nonisolated private final class RejectRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
