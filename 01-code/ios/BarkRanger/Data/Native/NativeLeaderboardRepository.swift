import CryptoKit
import Foundation

actor NativeLeaderboardRepository: LeaderboardReading {
    nonisolated struct Snapshot: Decodable, Sendable {
        let version: Int
        let entries: [LeaderboardEntry]
        let standing: LeaderboardStanding?
        let ownID: String
        let standingUnavailable: Bool
    }
    let transport: NativeCallableTransport
    let uid: String
    private var snapshot: Snapshot?
    init(transport: NativeCallableTransport, uid: String) {
        self.transport = transport
        self.uid = uid
    }
    nonisolated func entryID(uid: String) -> String {
        SHA256.hash(data: Data("bark-native-leaderboard:\(uid)".utf8)).map { String(format: "%02x", $0) }
            .joined()
    }
    func topFive() async throws -> [LeaderboardEntry] {
        nonisolated struct Request: Encodable, Sendable {
            let kind = "leaderboard"
            let query = ["version": 1]
        }
        let value = try await transport.call("nativeRead", input: Request(), as: Snapshot.self)
        guard value.version == 1, value.entries.count <= 5, value.ownID == entryID(uid: uid),
            Set(value.entries.map(\.id)).count == value.entries.count,
            value.standing == nil || value.standing?.entry.id == value.ownID,
            (value.standing?.rank ?? 1) > 0
        else { throw NativeCallableTransport.Failure.invalidReply }
        let entries = value.entries + [value.standing?.entry].compactMap { $0 }
        guard
            entries.allSatisfy({
                $0.id.count == 64 && $0.points >= 0 && !$0.name.isEmpty && $0.name.utf16.count <= 80
            }),
            zip(value.entries, value.entries.dropFirst()).allSatisfy({ $0.points >= $1.points })
        else {
            throw NativeCallableTransport.Failure.invalidReply
        }
        snapshot = value
        return value.entries
    }
    func standing(uid: String) async throws -> LeaderboardStanding? {
        // Local state only: topFive() already validated what the server returned. Another
        // account's uid means this client belongs to someone else; no snapshot means the
        // caller asked before a successful topFive().
        guard uid == self.uid else { throw NativeCallableTransport.Failure.accountChanged }
        guard let snapshot else { throw NativeCallableTransport.Failure.invalidRequest }
        guard !snapshot.standingUnavailable else { throw URLError(.cannotLoadFromNetwork) }
        return snapshot.standing
    }
    func close() async {
        snapshot = nil
        await transport.close()
    }
}
