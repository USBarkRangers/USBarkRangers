import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeTripIdentityTests {
    @Test func deletedAccountDropsItsFailedCheckpointRecoveryBuffer() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let editor = fixture.model(checkpoint: { _, _, _ in throw CocoaError(.fileWriteOutOfSpace) })
        editor.activeTrip.start()
        editor.open(fixture.a)
        let removedScope = try #require(fixture.session.tripScope)
        editor.rename("Private deleted unsaved buffer")
        await editor.activeTrip.waitForCheckpoint()
        #expect(editor.checkpointNeedsRetry)
        fixture.auth.select("user-b")
        try await eventually { fixture.session.nativeTrips?.scope.hasSuffix(":user-b") == true }
        try editor.activeTrip.forgetDeletedAccount(scope: removedScope)
        fixture.auth.select("user-a")
        try await eventually { fixture.session.nativeTrips?.scope.hasSuffix(":user-a") == true }
        #expect(editor.draft?.trip.name != "Private deleted unsaved buffer")
        await fixture.session.stopAndWait()
    }
    @Test func failedCheckpointBlocksSignOutAndForcedSwitchRetainsOnlyTheOriginalScopesBuffer() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        var fail = true
        let editor = fixture.model(checkpoint: { repository, draft, base in
            if fail { throw CocoaError(.fileWriteOutOfSpace) }
            return try await repository.checkpoint(draft, replacing: base)
        })
        editor.activeTrip.start()
        editor.open(fixture.a)
        editor.rename("Private unsaved A")
        await editor.activeTrip.waitForCheckpoint()
        #expect(editor.checkpointNeedsRetry)
        let account = AccountModel(session: fixture.session)
        account.signOut()
        await account.action?.value
        #expect(fixture.session.identity?.uid == "user-a")
        #expect(account.notice?.contains("before changing accounts") == true)
        #expect(editor.draft?.trip.name == "Private unsaved A")

        fixture.auth.select("user-b")
        try await eventually { fixture.session.nativeTrips?.scope.hasSuffix(":user-b") == true }
        #expect(editor.draft == nil)
        #expect(
            try await fixture.session.nativeTrips?.repository.store.tripLocalLists().drafts.isEmpty == true)
        fixture.auth.select("user-a")
        try await eventually { editor.draft?.trip.name == "Private unsaved A" && editor.checkpointPending }
        fail = false
        editor.requestCheckpoint()
        #expect(await editor.awaitCheckpoint())
        #expect(
            try await fixture.session.nativeTrips?.repository.currentDraft(id: fixture.a.id)?.trip.name
                == "Private unsaved A")
        await fixture.session.stopAndWait()
    }
}
