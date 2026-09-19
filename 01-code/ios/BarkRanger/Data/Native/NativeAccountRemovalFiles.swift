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
    /// The fence for one owner. It reads only the hashed filename, so it still holds
    /// when a marker's contents can no longer be decoded.
    static func isPending(_ request: Request, directory: URL) -> Bool {
        FileManager.default.fileExists(atPath: file(request, directory: directory).path)
    }
    /// A marker that cannot be trusted is set aside, never thrown: its owner cannot be
    /// recovered from a hash, and one damaged file must not strand every other cleanup.
    static func pending(directory: URL, unreadable: (any Error) -> Void = { _ in }) throws -> [Request] {
        let folder = directory.appendingPathComponent("removals-v1")
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.compactMap { url in
                do { return try read(url, directory: directory) } catch {
                    unreadable(error)
                    try? FileManager.default.moveItem(at: url, to: url.appendingPathExtension("unreadable"))
                    return nil
                }
            }
    }
    private static func read(_ url: URL, directory: URL) throws -> Request {
        let request = try JSONDecoder().decode(Request.self, from: Data(contentsOf: url))
        try validate(request)
        // Enumeration already restricts these to this folder's direct children.
        // Check the exact hashed owner filename, not platform-dependent URL identity.
        guard file(request, directory: directory).lastPathComponent == url.lastPathComponent else {
            throw NativeStore.Failure.wrongScope
        }
        return request
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
