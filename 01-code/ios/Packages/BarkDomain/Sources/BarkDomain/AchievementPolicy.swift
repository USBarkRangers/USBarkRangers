import Foundation

/// Pure passport progress and earned-record merge. The server validates awards from accepted visits.
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
    public static func summarize(snapshot: PersonalSnapshot, catalog: CatalogSnapshot) -> Summary {
        var index: [String: Park] = [:]
        var totals: [String: Set<String>] = [:]
        for park in catalog.parks {
            index[park.id.rawValue] = park
            for alias in park.aliases { index[alias.rawValue] = park }
            for state in park.stateCodes { totals[state, default: []].insert(park.siteID.rawValue) }
        }
        var sites = Set<String>()
        var verified = Set<String>()
        var states: [String: Set<String>] = [:]
        var verifiedStates: [String: Set<String>] = [:]
        for visit in Visit.records(in: snapshot.profile) {
            let park = visit.parkID.flatMap { index[$0] }
            let key = park?.siteID.rawValue ?? siteKey(visit)
            sites.insert(key)
            if visit.verified { verified.insert(key) }
            for state in park?.stateCodes ?? [] {
                states[state, default: []].insert(key)
                if visit.verified { verifiedStates[state, default: []].insert(key) }
            }
        }
        let rawPoints = snapshot.profile.fields["walkPoints"]?.number ?? 0
        let historical =
            rawPoints.isFinite
            ? Int(max(0, min(1_000_000_000, (min(rawPoints, 1_000_000_000) * 100).rounded() / 100))) : 0
        return Summary(
            sites: sites.count, verifiedSites: verified.count,
            catalogSites: Set(catalog.parks.map(\.siteID)).count,
            points: sites.count + verified.count + historical,
            states: states.mapValues(\.count), verifiedStates: verifiedStates.mapValues(\.count),
            stateTotals: totals.mapValues(\.count))
    }
    public static func siteKey(_ visit: Visit) -> String {
        let name = visit.name.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        if !name.isEmpty, let coordinate = visit.coordinate {
            return String(
                format: "%@|%.5f,%.5f", locale: Locale(identifier: "en_US_POSIX"), name, coordinate.latitude,
                coordinate.longitude)
        }
        return visit.id
    }
    public static func evaluate(
        definitions: [Definition], summary: Summary, snapshot: PersonalSnapshot,
        rank: Int?, timeZone: TimeZone = .current
    ) -> [Badge] {
        let visits = Visit.records(in: snapshot.profile)
        let stored = mergedHistory(snapshot)
        let knownStates = Set(definitions.compactMap(\.state))
        let totalStates = summary.states.filter { knownStates.contains($0.key) }
        let verifiedStates = summary.verifiedStates.filter { knownStates.contains($0.key) }
        let east = Set(["ME", "NH", "MA", "RI", "CT", "NY", "NJ", "DE", "MD", "VA", "NC", "SC", "GA", "FL"])
        let west = Set(["WA", "OR", "CA"])
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let dates = visits.compactMap(\.visitedAt).sorted()
        let localDates = visits.compactMap { visit -> DateComponents? in
            guard let date = visit.visitedAt else { return nil }
            var visitCalendar = calendar
            visitCalendar.timeZone =
                visit.fields["timeZone"]?.string.flatMap(TimeZone.init(identifier:)) ?? timeZone
            return visitCalendar.dateComponents([.hour, .month, .day], from: date)
        }
        return definitions.map { definition in
            var earned = false
            var verified = false
            switch definition.rule {
            case "visits":
                earned = summary.sites >= definition.target
                verified = summary.verifiedSites >= definition.target
            case "states":
                earned = totalStates.count >= definition.target
                verified = verifiedStates.count >= definition.target
            case "stateVisits":
                earned = (totalStates.values.max() ?? 0) >= definition.target
                verified = (verifiedStates.values.max() ?? 0) >= definition.target
            case "coasts":
                earned = !east.isDisjoint(with: totalStates.keys) && !west.isDisjoint(with: totalStates.keys)
                verified =
                    !east.isDisjoint(with: verifiedStates.keys) && !west.isDisjoint(with: verifiedStates.keys)
            case "state":
                let state = definition.state ?? ""
                let target = max(1, summary.stateTotals[state] ?? 1)
                earned = (summary.states[state] ?? 0) >= target
                verified = (summary.verifiedStates[state] ?? 0) >= target
            case "rank":
                earned = rank == 1
                verified = earned
            case "complete":
                earned = summary.catalogSites > 0 && summary.sites >= summary.catalogSites
                verified = earned
            case "marathon":
                earned =
                    dates.count >= 4
                    && dates.indices.dropFirst(3).contains {
                        dates[$0].timeIntervalSince(dates[$0 - 3]) <= 86_400
                    }
                verified = earned
            case "night", "early", "christmas":
                earned = localDates.contains { values in
                    switch definition.rule {
                    case "night": return (values.hour ?? 12) < 4
                    case "early": return (4..<7).contains(values.hour ?? 12)
                    default: return values.month == 12 && values.day == 25
                    }
                }
                verified = earned
            default: break
            }
            let old = stored[definition.id]?.object
            return Badge(
                definition: definition, earned: earned || old != nil,
                verified: verified || old?["tier"]?.string == "verified", date: old?["dateEarned"]?.date)
        }
    }
    public static func mergedHistory(_ snapshot: PersonalSnapshot) -> [String: UserValue] {
        var result = snapshot.profile.fields["achievements"]?.object ?? [:]
        for record in snapshot.achievements {
            var fields = record.fields
            if let existing = result[record.id]?.object {
                fields.merge(existing, uniquingKeysWith: { _, new in new })
                let dates = [record.fields["dateEarned"]?.date, existing["dateEarned"]?.date].compactMap {
                    $0
                }
                if let date = dates.min() {
                    fields["dateEarned"] = .number(date.timeIntervalSince1970 * 1000)
                }
                if record.fields["tier"]?.string == "verified" || existing["tier"]?.string == "verified" {
                    fields["tier"] = .string("verified")
                }
            }
            result[record.id] = .object(fields)
        }
        return result
    }
    public static func dayKey(_ date: Date, timeZone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)
    }
}
