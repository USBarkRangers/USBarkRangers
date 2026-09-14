import Foundation

/// Passport definitions and presentation; native progress is server-owned. The server validates awards from accepted visits.
public enum AchievementPolicy {
    public struct Definition: Codable, Equatable, Sendable, Identifiable {
        public let id: String, name: String, category: String, rule: String, criteria: String
        public let target: Int
        public let classified: Bool
        public let state: String?
    }
    public struct Badge: Equatable, Sendable, Identifiable {
        public let definition: Definition
        public let earned: Bool, verified: Bool
        public let date: Date?
        public var id: String { definition.id }
    }
    public struct Summary: Equatable, Sendable {
        public let sites: Int, verifiedSites: Int, catalogSites: Int, points: Int
        public let states: [String: Int], verifiedStates: [String: Int], stateTotals: [String: Int]
        public var title: String { level.title }
        /// Level numbers label the existing title ladder; they are never stored as separate progress.
        public var level: Level {
            let index = Self.titles.lastIndex { points >= $0.points } ?? 0
            let current = Self.titles[index]
            let next = Self.titles.dropFirst(index + 1).first?.points
            return Level(
                number: index + 1, title: current.title, minimumPoints: current.points, nextPoints: next)
        }
        private static let titles: [(points: Int, title: String)] = [
            (0, "B.A.R.K. Trainee"), (10, "B.A.R.K. Ranger"), (25, "Trail Blazer"),
            (50, "B.A.R.K. Master"), (100, "Trail Legend"), (200, "Apex Ranger"),
            (300, "National Treasure"), (500, "Legendary Ranger"),
        ]
    }
    public struct Level: Equatable, Sendable {
        public let number: Int
        public let title: String
        public let minimumPoints: Int
        public let nextPoints: Int?
    }
    public static func definitions() throws -> [Definition] {
        guard let url = Bundle.module.url(forResource: "achievement-definitions", withExtension: "json")
        else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode([Definition].self, from: Data(contentsOf: url))
    }
    public static func dayKey(_ date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }
}
