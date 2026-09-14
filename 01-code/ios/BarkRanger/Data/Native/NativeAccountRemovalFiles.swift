import CryptoKit
import Foundation

/// A deletion accepted by the server remains a local cleanup task across app termination.
/// Contains only owner identity; never credentials or copies of the data being removed.
nonisolated enum NativeAccountRemovalFiles {
    struct Request: Codable, Equatable {
        let project: String
        let uid: String
    }
    private static func key(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func file(_ request: Request, directory: URL) -> URL {
        directory.appendingPathComponent("removals-v1")
            .appendingPathComponent(key(request.project + ":" + request.uid) + ".json")
    }
    static func retain(_ request: Request, directory: URL) throws {
        try validate(request)
        let url = file(request, directory: directory)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(request).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    static func pending(directory: URL) throws -> [Request] {
        let folder = directory.appendingPathComponent("removals-v1")
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.map { url in
                let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: url))
                try validate(request)
                guard file(request, directory: directory) == url else { throw NativeStore.Failure.wrongScope }
                return request
            }
    }
    /// All writers must be drained first. Only these exact, hashed owner directories are removed.
    static func eraseClosedAccount(_ request: Request, directory: URL) throws {
        try validate(request)
        let folders = [try NativeStore.scopeDirectory(directory: directory, project: request.project, uid: request.uid),
            directory.appendingPathComponent(key(request.uid))] // Recording and feedback drafts.
        for folder in folders where FileManager.default.fileExists(atPath: folder.path) {
            try FileManager.default.removeItem(at: folder)
        }
    }
    static func finish(_ request: Request, directory: URL) throws {
        try FileManager.default.removeItem(at: file(request, directory: directory))
    }
    private static func validate(_ request: Request) throws {
        guard ["bark-ranger-ios", "demo-bark-native"].contains(request.project),
            !request.uid.isEmpty, !request.uid.contains("/") else { throw NativeStore.Failure.wrongScope }
    }
}
