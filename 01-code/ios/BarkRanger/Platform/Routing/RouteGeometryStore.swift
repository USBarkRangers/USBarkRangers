import CryptoKit
import Foundation

/// Disposable, account-scoped road segments. No trip records, cloud access or UI ownership.
/// Each completed segment commits atomically; reads never renew its 30-day lifetime.
actor RouteGeometryStore {
    private struct Record: Codable {
        let key: String
        let route: RoadRoute.Snapshot
    }
    private struct File {
        let bytes: Int
        let writtenAt: Date
    }
    private let directory: URL
    private let maximumBytes: Int
    private let maximumRecordBytes = 4 * 1024 * 1024
    private var files: [URL: File] = [:]
    private var scannedAt: Date?
    private let diagnostics = Diagnostics()

    init(directory: URL, maximumBytes: Int = 64 * 1024 * 1024) {
        self.directory = directory
        self.maximumBytes = maximumBytes
    }
    func load(keys: [String], scope: String, now: Date) -> [String: RoadRoute.Snapshot] {
        maintain(at: now)
        var result: [String: RoadRoute.Snapshot] = [:]
        for key in Set(keys) {
            guard !Task.isCancelled else { return [:] }
            let url = location(key: key, scope: scope)
            guard let file = files[url] else { continue }
            do {
                guard file.bytes <= maximumRecordBytes else { throw Failure.invalid }
                let data = try Data(contentsOf: url)
                guard data.count <= maximumRecordBytes else { throw Failure.invalid }
                let record = try PropertyListDecoder().decode(Record.self, from: data)
                guard record.key == key, record.route.isValid(at: now) else { throw Failure.invalid }
                result[key] = record.route
            } catch {
                remove(url)
                diagnostics.record(.routeCacheReadFailed)
            }
        }
        return result
    }
    func save(_ route: RoadRoute.Snapshot, key: String, scope: String, now: Date) {
        guard !Task.isCancelled, route.isValid(at: now) else { return }
        maintain(at: now)
        do {
            let encoder = PropertyListEncoder()
            encoder.outputFormat = .binary
            let data = try encoder.encode(Record(key: key, route: route))
            guard data.count <= min(maximumRecordBytes, maximumBytes) else { return }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var folder = directory
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try folder.setResourceValues(values)
            let url = location(key: key, scope: scope)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            // Metadata permits bounded cleanup without decoding every saved polyline.
            try FileManager.default.setAttributes(
                [.modificationDate: route.fetchedAt], ofItemAtPath: url.path)
            files[url] = File(bytes: data.count, writtenAt: route.fetchedAt)
            trim(at: now)
        } catch {
            diagnostics.record(.routeCacheWriteFailed)
        }
    }
    private enum Failure: Error { case invalid }
    /// Historical cache filenames hash owner+route together; they cannot be reverse-mapped.
    /// On account deletion, clear this disposable geometry cache (never authored trips).
    func clearForAccountDeletion() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
        files = [:]
        scannedAt = nil
    }
    private func location(key: String, scope: String) -> URL {
        let value = "\(scope.utf8.count):\(scope)|\(key)"
        let hash = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash).appendingPathExtension("route")
    }
    private func maintain(at now: Date) {
        if let scannedAt, now >= scannedAt, now.timeIntervalSince(scannedAt) < 3600 { return }
        do {
            let urls = try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles])
            files = [:]
            for url in urls where url.pathExtension == "route" {
                let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                if let bytes = values.fileSize, let date = values.contentModificationDate {
                    files[url] = File(bytes: bytes, writtenAt: date)
                }
            }
            scannedAt = now
            trim(at: now)
        } catch CocoaError.fileReadNoSuchFile {
            files = [:]
            scannedAt = now
        } catch { diagnostics.record(.routeCacheReadFailed) }
    }
    private func trim(at now: Date) {
        for (url, file) in files where now.timeIntervalSince(file.writtenAt) >= RoadRoute.Snapshot.lifetime {
            remove(url)
        }
        var bytes = files.values.reduce(0) { $0 + $1.bytes }
        guard bytes > maximumBytes || files.count > 5_000 else { return }
        for (url, file) in files.sorted(by: { $0.value.writtenAt < $1.value.writtenAt }) {
            guard bytes > maximumBytes || files.count > 5_000 else { break }
            remove(url)
            bytes -= file.bytes
        }
    }
    private func remove(_ url: URL) {
        do {
            try FileManager.default.removeItem(at: url)
            files[url] = nil
        } catch CocoaError.fileNoSuchFile {
            files[url] = nil
        } catch { diagnostics.record(.routeCacheCleanupDeferred) }
    }
}
