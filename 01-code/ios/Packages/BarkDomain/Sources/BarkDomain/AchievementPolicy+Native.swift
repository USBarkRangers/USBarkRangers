import Foundation

extension AchievementPolicy {
    /// Server-owned current progress and fixed catalog facts are sufficient. No visit
    /// archive decoding or whole-account snapshot is involved in passport presentation.
    public static func summarize(progress: NativeProgress?, catalog: CatalogSnapshot) throws -> Summary {
        try progress?.validate()
        var totals: [String: Set<SiteID>] = [:]
        for park in catalog.parks {
            for state in park.stateCodes { totals[state, default: []].insert(park.siteID) }
        }
        return Summary(
            sites: progress?.sites ?? 0, verifiedSites: progress?.verifiedSites ?? 0,
            catalogSites: Set(catalog.parks.map(\.siteID)).count, points: progress?.points ?? 0,
            states: progress?.states ?? [:], verifiedStates: progress?.verifiedStates ?? [:],
            stateTotals: totals.mapValues(\.count))
    }
    public static func badges(progress: NativeProgress?, definitions: [Definition]) throws -> [Badge] {
        try progress?.validate()
        return definitions.map { definition in
            let award = progress?.awards[definition.id]
            return Badge(
                definition: definition, earned: award != nil, verified: award?.tier == .verified,
                date: award?.earnedAt)
        }
    }
}
