import BarkDomain
import Foundation

/// One atomic envelope pairs the manifest with its exact bytes; interrupted commits cannot mix revisions.
nonisolated struct CatalogDiskStore: Sendable {
    enum Failure: Error { case size }
    struct Envelope: Codable, Sendable {
        let manifest: CatalogManifest
        let payload: Data
    }
    struct Candidate: Sendable {
        let envelope: Envelope
        let source: CatalogSource
    }
    let directory: URL
    let bundleDirectory: URL

    func loadCandidates(diagnostics: Diagnostics = Diagnostics()) -> [Candidate] {
        var candidates: [Candidate] = []
        for name in ["current.json", "previous.json"] {
            do {
                let data = try boundedRead(
                    directory.appendingPathComponent(name), maximum: CatalogValidator.maximumBytes * 2)
                let envelope = try JSONDecoder().decode(Envelope.self, from: data)
                candidates.append(Candidate(envelope: envelope, source: .saved))
            } catch CocoaError.fileReadNoSuchFile {
                // An absent cache is normal on first launch; corruption and other read failures are not.
            } catch { diagnostics.catalogFailure(readFailure(error), at: .cacheRead) }
        }
        do {
            let metadata = try boundedRead(
                bundleDirectory.appendingPathComponent("catalog-manifest.json"), maximum: 16_384)
            let manifest = try JSONDecoder().decode(CatalogManifest.self, from: metadata)
            let payload = try boundedRead(
                bundleDirectory.appendingPathComponent("catalog.json"), maximum: CatalogValidator.maximumBytes
            )
            candidates.append(
                Candidate(envelope: Envelope(manifest: manifest, payload: payload), source: .bundle))
        } catch { diagnostics.catalogFailure(readFailure(error), at: .bundleRead) }
        return candidates
    }

    /// Preserve the repository's validated previous value, not potentially corrupt disk contents.
    func commit(_ envelope: Envelope, previous: Envelope?) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let previous {
            try JSONEncoder().encode(previous).write(
                to: directory.appendingPathComponent("previous.json"), options: .atomic)
        }
        try JSONEncoder().encode(envelope).write(
            to: directory.appendingPathComponent("current.json"), options: .atomic)
        var location = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? location.setResourceValues(values)
    }
    private func readFailure(_ error: any Error) -> Diagnostics.CatalogFailure {
        if error is DecodingError { return .decoding }
        if case Failure.size = error { return .size }
        return .storage
    }
    private func boundedRead(_ url: URL, maximum: Int) throws -> Data {
        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maximum else {
            throw Failure.size
        }
        return try Data(contentsOf: url)
    }
}
