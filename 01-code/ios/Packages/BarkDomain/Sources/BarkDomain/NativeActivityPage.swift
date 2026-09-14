import Foundation

public struct NativeActivityPage: Codable, Equatable, Sendable {
    public struct Cursor: Codable, Equatable, Sendable {
        public let happenedAtMs: Int64
        public let id: String
        public init(happenedAtMs: Int64, id: String) {
            self.happenedAtMs = happenedAtMs
            self.id = id
        }
    }
    public let version: Int
    public let items: [NativeActivityRecord]
    public let readTime: NativeServerTime
    public let next: Cursor?
    public func validate(after cursor: Cursor?) throws {
        guard version == 1, items.count <= 50, Set(items.map(\.id)).count == items.count else {
            throw NativeRecordValidation.Failure.malformed
        }
        var previous = cursor
        for item in items {
            try item.validate()
            guard let details = item.details, item.updatedAt <= readTime else {
                throw NativeRecordValidation.Failure.malformed
            }
            if let previous,
                !(details.happenedAtMs < previous.happenedAtMs
                    || (details.happenedAtMs == previous.happenedAtMs && item.id < previous.id))
            {
                throw NativeRecordValidation.Failure.malformed
            }
            previous = .init(happenedAtMs: details.happenedAtMs, id: item.id)
        }
        if let next, items.count != 50 || next != previous { throw NativeRecordValidation.Failure.malformed }
    }
}
