import BarkDomain
import CryptoKit
import Foundation

/// One protected checkpoint per UID; append-only sample bytes never enter account sync.
actor RecordingStore {
    enum Failure: Error { case wrongAccount, invalid, alreadyRecording, limit }
    private let directory: URL
    private let beforeWrite: (@Sendable () throws -> Void)?
    init(directory: URL, beforeWrite: (@Sendable () throws -> Void)? = nil) {
        self.directory = directory
        self.beforeWrite = beforeWrite
    }
    private func folder(_ uid: String) throws -> URL {
        guard !uid.isEmpty else { throw Failure.wrongAccount }
        let key = SHA256.hash(data: Data(uid.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(key, isDirectory: true).appendingPathComponent(
            "Recording", isDirectory: true)
    }
    func recover(uid: String) throws -> WalkRecording? {
        let file = try folder(uid).appendingPathComponent("recording.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let value = try JSONDecoder().decode(WalkRecording.self, from: Data(contentsOf: file))
        guard value.uid == uid, UUID(uuidString: value.id) != nil,
            value.meters.isFinite, value.meters >= 0, value.elapsedSeconds.isFinite,
            value.elapsedSeconds >= 0, value.sampleBytes <= 50_000_000
        else { throw Failure.invalid }
        return value
    }
    func begin(_ recording: WalkRecording) throws {
        try Task.checkCancellation()
        guard try recover(uid: recording.uid) == nil else { throw Failure.alreadyRecording }
        let folder = try folder(recording.uid)
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try beforeWrite?()
        try Data().write(
            to: folder.appendingPathComponent("samples.jsonl"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try checkpoint(recording)
    }
    @discardableResult func append(_ points: [RecordedPoint], checkpoint recording: WalkRecording) throws
        -> WalkRecording
    {
        try Task.checkCancellation()
        guard let old = try recover(uid: recording.uid), old.id == recording.id else { throw Failure.invalid }
        let file = try folder(recording.uid).appendingPathComponent("samples.jsonl")
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }
        // A crash after appending but before checkpoint replacement leaves a tail to trim, not double-count.
        guard try handle.seekToEnd() >= old.sampleBytes else { throw Failure.invalid }
        try beforeWrite?()
        try handle.truncate(atOffset: old.sampleBytes)
        try handle.seek(toOffset: old.sampleBytes)
        for point in points {
            var bytes = try JSONEncoder().encode(point)
            bytes.append(10)
            try handle.write(contentsOf: bytes)
        }
        try handle.synchronize()
        var next = recording
        next.sampleBytes = try handle.offset()
        guard next.sampleBytes <= 50_000_000 else { throw Failure.limit }
        try checkpoint(next)
        return next
    }
    private func checkpoint(_ recording: WalkRecording) throws {
        try beforeWrite?()
        let data = try JSONEncoder().encode(recording)
        try data.write(
            to: folder(recording.uid).appendingPathComponent("recording.json"),
            options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func points(uid: String) throws -> [RecordedPoint] {
        guard let record = try recover(uid: uid) else { return [] }
        let file = try folder(uid).appendingPathComponent("samples.jsonl")
        if record.phase == .finishing, !FileManager.default.fileExists(atPath: file.path) { return [] }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: Int(record.sampleBytes)) ?? Data()
        guard data.count == record.sampleBytes else { throw Failure.invalid }
        return try data.split(separator: 10).map {
            try JSONDecoder().decode(RecordedPoint.self, from: Data($0))
        }
    }
    /// Caller first durably stages the matching completed summary, or explicitly confirms discard.
    func remove(uid: String, id: String) throws {
        guard let record = try recover(uid: uid), record.id == id else { throw Failure.invalid }
        try beforeWrite?()
        // Finish is already durably staged (or discard was confirmed). Retire recovery atomically first.
        // Failure here leaves both files intact. A leftover sample file is replaced on the next begin.
        let folder = try folder(uid)
        try FileManager.default.removeItem(at: folder.appendingPathComponent("recording.json"))
        try? FileManager.default.removeItem(at: folder.appendingPathComponent("samples.jsonl"))
    }
}
