import BarkDomain
import CryptoKit
import Foundation

actor FeedbackDraftStore {
    private struct Saved: Codable {
        let owner: String
        let report: FeedbackReport
    }
    private let directory: URL
    private let beforeSave: (@Sendable () async throws -> Void)?
    init(directory: URL, beforeSave: (@Sendable () async throws -> Void)? = nil) {
        self.directory = directory
        self.beforeSave = beforeSave
    }
    private func url(owner: String) -> URL {
        let scope = owner.hasPrefix("account:") ? String(owner.dropFirst("account:".count)) : "feedback-guest"
        let key = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(key).appendingPathComponent("feedback.json")
    }
    func load(owner: String) throws -> FeedbackReport? {
        let file = url(owner: owner)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let saved = try JSONDecoder().decode(Saved.self, from: Data(contentsOf: file))
        guard saved.owner == owner else { throw CocoaError(.fileReadCorruptFile) }
        return saved.report
    }
    func save(_ report: FeedbackReport, owner: String) async throws {
        try await beforeSave?()
        try Task.checkCancellation()
        try FileManager.default.createDirectory(
            at: url(owner: owner).deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try JSONEncoder().encode(Saved(owner: owner, report: report)).write(
            to: url(owner: owner),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
