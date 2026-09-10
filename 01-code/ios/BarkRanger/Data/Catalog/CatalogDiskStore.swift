import BarkDomain
import Foundation

/// One atomic envelope pairs the manifest with its exact bytes; interrupted commits cannot mix revisions.
nonisolated struct CatalogDiskStore: Sendable {
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

    func loadCandidates() -> [Candidate] {
        var candidates: [Candidate] = []
        for name in ["current.json", "previous.json"] {
            if let data = boundedRead(
                directory.appendingPathComponent(name), maximum: CatalogValidator.maximumBytes * 2),
                let envelope = try? JSONDecoder().decode(Envelope.self, from: data)
            {
                candidates.append(Candidate(envelope: envelope, source: .saved))
            }
        }
        if let metadata = boundedRead(
            bundleDirectory.appendingPathComponent("catalog-manifest.json"), maximum: 16_384),
            let manifest = try? JSONDecoder().decode(CatalogManifest.self, from: metadata),
            let payload = boundedRead(
                bundleDirectory.appendingPathComponent("catalog.json"), maximum: CatalogValidator.maximumBytes
            )
        {
            candidates.append(
                Candidate(envelope: Envelope(manifest: manifest, payload: payload), source: .bundle))
        }
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
    private func boundedRead(_ url: URL, maximum: Int) -> Data? {
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maximum else {
            return nil
        }
        return try? Data(contentsOf: url)
    }
}
