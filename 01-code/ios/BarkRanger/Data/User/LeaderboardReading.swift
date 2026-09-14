import Foundation

nonisolated struct LeaderboardEntry: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let points: Int
}
nonisolated struct LeaderboardStanding: Codable, Equatable, Sendable {
    let entry: LeaderboardEntry
    let rank: Int
}
nonisolated protocol LeaderboardReading: Sendable {
    func topFive() async throws -> [LeaderboardEntry]
    func standing(uid: String) async throws -> LeaderboardStanding?
    func entryID(uid: String) -> String
}
extension LeaderboardReading {
    nonisolated func entryID(uid: String) -> String { uid }
}
