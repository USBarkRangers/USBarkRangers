import Foundation

/// Confirmed totals and earned evidence use fixed-size server projections. Pending
/// visits are shown separately; a lost reply plus a newer total never adds credit twice.
public enum NativePassport {
    public static func summary(progress: NativeProgress?, catalog: CatalogSnapshot) -> AchievementPolicy.Summary {
        var totals: [String: Set<SiteID>] = [:]
        for park in catalog.parks {
            for state in park.stateCodes { totals[state, default: []].insert(park.siteID) }
        }
        return AchievementPolicy.Summary(sites: progress?.sites ?? 0,
            verifiedSites: progress?.verifiedSites ?? 0,
            catalogSites: Set(catalog.parks.map(\.siteID)).count, points: progress?.points ?? 0,
            states: progress?.states ?? [:], verifiedStates: progress?.verifiedStates ?? [:],
            stateTotals: totals.mapValues(\.count))
    }
    public static func badges(progress: NativeProgress?) throws -> [AchievementPolicy.Badge] {
        try AchievementPolicy.definitions().map { definition in
            let earned = progress?.awards[definition.id]
            return .init(definition: definition, earned: earned != nil,
                verified: earned?.tier == .verified, date: earned?.earnedAt)
        }
    }
}
