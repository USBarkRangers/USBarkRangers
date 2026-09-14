@preconcurrency import FirebaseFirestore
import Foundation

/// Matches the web's totalPoints contract; this display does not attest historical scores.
actor LeaderboardRepository: LeaderboardReading {
    typealias Entry = LeaderboardEntry
    typealias Standing = LeaderboardStanding
    private let db: Firestore
    init(db: Firestore) { self.db = db }

    func topFive() async throws -> [Entry] {
        try Task.checkCancellation()
        let documents = try await db.collection("leaderboard")
            .order(by: "totalPoints", descending: true).limit(to: 5).getDocuments(source: .server)
        try Task.checkCancellation()
        return documents.documents.compactMap(Self.entry)
    }

    func standing(uid: String) async throws -> Standing? {
        try Task.checkCancellation()
        let collection = db.collection("leaderboard")
        let document = try await collection.document(uid).getDocument(source: .server)
        try Task.checkCancellation()
        guard let entry = Self.entry(document) else { return nil }
        // The web's personal rank is the number of higher scores + 1; ties share that rank.
        let higher = try await collection.whereField("totalPoints", isGreaterThan: entry.points)
            .count.getAggregation(source: .server)
        try Task.checkCancellation()
        return Standing(entry: entry, rank: higher.count.intValue + 1)
    }

    private static func entry(_ document: DocumentSnapshot) -> Entry? {
        let fields = document.data() ?? [:]
        guard let points = fields["totalPoints"] as? NSNumber,
            points.doubleValue.isFinite, points.doubleValue >= 0,
            points.doubleValue < Double(Int.max)
        else { return nil }
        let name = (fields["displayName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return Entry(
            id: document.documentID, name: name.flatMap { $0.isEmpty ? nil : $0 } ?? "BARK Ranger",
            points: points.intValue)
    }
}
