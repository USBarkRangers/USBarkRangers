import Testing

@testable import BarkDomain

struct PassportLevelTests {
    @Test func numberedLevelsPreserveEveryExistingTitleBoundary() {
        let ladder = [
            (0, "B.A.R.K. Trainee"), (10, "B.A.R.K. Ranger"), (25, "Trail Blazer"),
            (50, "B.A.R.K. Master"), (100, "Trail Legend"), (200, "Apex Ranger"),
            (300, "National Treasure"), (500, "Legendary Ranger"),
        ]
        for (index, entry) in ladder.enumerated() {
            let current = summary(points: entry.0)
            #expect(current.title == entry.1)
            #expect(current.level.number == index + 1)
            #expect(current.level.minimumPoints == entry.0)
            #expect(current.level.nextPoints == ladder.dropFirst(index + 1).first?.0)
            if index > 0 {
                let below = summary(points: entry.0 - 1)
                #expect(below.level.number == index)
                #expect(below.title == ladder[index - 1].1)
            }
        }
        #expect(summary(points: 1_000_000).level == summary(points: 500).level)
    }

    private func summary(points: Int) -> AchievementPolicy.Summary {
        .init(
            sites: 0, verifiedSites: 0, catalogSites: 0, points: points,
            states: [:], verifiedStates: [:], stateTotals: [:])
    }
}
