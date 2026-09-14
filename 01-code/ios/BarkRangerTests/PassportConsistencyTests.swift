import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct PassportConsistencyTests {
    @Test func acceptedCatalogChangesRefreshVisibleProgressWithoutAnAccountEdit() async throws {
        try await withPassport { model, context, _ in
            let observation = Task { await model.observeProgress() }
            defer { observation.cancel() }
            try await eventually { model.content != nil }
            #expect(model.content?.summary.catalogSites == 393)
            await context.catalog.refresh(reason: .manual)
            #expect(await context.catalog.current().snapshot?.parks.count == 5000)
            try await eventually { model.content?.summary.catalogSites == 5000 }
        }
    }

    @Test(arguments: [false, true])
    func cancelledVisitCannotStageAnIntentAfterReachingTheStore(_ proximity: Bool) async throws {
        try await withPassport { _, context, store in
            let catalog = try #require(await context.catalog.current().snapshot)
            let park = try #require(catalog.parks.first { !$0.isRetired })
            let before = try await store.nativeVisitOverview()
            let write = Task {
                withUnsafeCurrentTask { $0?.cancel() }
                let fix =
                    proximity
                    ? LocationFix(coordinate: park.coordinate, accuracy: 10, date: Date()) : nil
                _ = try await store.markNativeVisit(park: park, fix: fix, now: Date())
            }
            await #expect(throws: CancellationError.self) { try await write.value }
            #expect(try await store.nativeVisitOverview() == before)
        }
    }

    @Test func failedDateEditRetainsContextAndSuccessfulRetryPreservesVerification() async throws {
        try await withPassport { model, context, store in
            let catalog = try #require(await context.catalog.current().snapshot)
            let park = try #require(catalog.parks.first { !$0.isRetired })
            _ = try await store.markNativeVisit(
                park: park,
                fix: .init(coordinate: park.coordinate, accuracy: 10, date: Date()))
            let selected = try await store.nativeVisitWorkingState(
                siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue)
            let before = try await store.nativeVisitOverview()
            var completions = 0
            model.changeDate(selected, date: Date().addingTimeInterval(3600)) { completions += 1 }
            try await eventually { !model.working }
            #expect(completions == 0 && model.notice != nil)
            #expect(try await store.nativeVisitOverview() == before)

            let date = Date(timeIntervalSince1970: 1_700_000_000)
            model.changeDate(selected, date: date) { completions += 1 }
            // Another tap while the first write owns the action slot cannot report false success.
            model.changeDate(selected, date: date.addingTimeInterval(10)) { completions += 10 }
            try await eventually { !model.working }
            let changed = try await store.nativeVisitWorkingState(
                siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue)
            let visit = try #require(changed.draft)
            #expect(completions == 1 && model.notice == nil)
            #expect(visit.happenedAt == date && visit.verified)
            model.remove([changed]) { completions += 1 }
            try await eventually { !model.working }
            #expect(completions == 2)
            #expect(
                try await store.nativeVisitWorkingState(
                    siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue
                ).draft == nil)
        }
    }

    @Test func cancelledObservationAndResetCannotRepopulatePassportOrCompleteAnOldEdit() async throws {
        try await withPassport { model, context, store in
            let observation = Task { await model.observeProgress() }
            try await eventually { model.content != nil }
            observation.cancel()
            await observation.value
            let before = try await store.nativeVisitOverview()
            var completed = false
            let park = try #require(await context.catalog.current().snapshot?.parks.first)
            let selected = try await store.nativeVisitWorkingState(
                siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue)
            model.changeDate(selected, date: Date()) { completed = true }
            model.resetScope()
            await context.catalog.refresh(reason: .manual)
            #expect(model.content == nil && !model.working && !completed)
            #expect(try await store.nativeVisitOverview() == before)
        }
    }

    private func withPassport(
        _ body: (PassportModel, DiscoveryTestContext, NativeStore) async throws -> Void
    ) async throws {
        let context = try DiscoveryTestContext(scenario: "large")
        defer { context.close() }
        try await context.start()
        let auth = SyntheticAuth()
        let (app, _, _) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let configuration = NativeProfileConfiguration(
            project: "demo-bark-native",
            connect: {
                try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0)
            })
        let account = AccountSession(
            auth: auth, directory: context.disk.directory.appendingPathComponent("account"),
            capabilities: .editableTest, nativeProfileConfiguration: configuration)
        account.start()
        auth.select("passport-consistency")
        do {
            try await eventually { account.nativeVisits != nil }
            let store = try #require(account.nativeVisits?.repository.store)
            try await store.acceptProfile(.init(revision: 1, displayName: "Ranger"))
            try await store.acceptEntitlement(
                .init(
                    revision: 1, premium: true, source: .production,
                    validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
            try await eventually { account.dataAccess.canEditAccount }
            let model = PassportModel(
                account: account, catalog: context.catalog,
                leaderboard: LeaderboardModel(repository: nil, account: account))
            do {
                try await body(model, context, store)
                model.resetScope()
            } catch {
                model.resetScope()
                throw error
            }
            await account.stopAndWait()
        } catch {
            await account.stopAndWait()
            throw error
        }
    }
}
