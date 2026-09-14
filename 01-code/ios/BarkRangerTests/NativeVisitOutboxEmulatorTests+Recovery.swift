import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

extension NativeVisitOutboxEmulatorTests {
    func verifyRemoteDeletionRecovery(
        store: NativeStore, cloud: NativeVisitCloud, sync: NativeVisitSync, park: Park,
        setFailure: @Sendable (Bool) -> Void
    ) async throws {
        let repository = NativeVisitRepository(store: store, cloud: cloud)
        try await repository.mark(park: park)
        let beforeAck = try await repository.workingState(park: park)
        #expect(try await sync.synchronize().pendingCount == 0)
        let correctedDate = Date().addingTimeInterval(-172_800)
        // An acknowledgment alone must not invalidate the same selected event/revision.
        try await repository.changeDate(selected: beforeAck, date: correctedDate, timeZone: .gmt)
        let local = try await repository.workingState(park: park)
        let conflictID = try #require(local.pendingOperationID)
        let before = try #require(beforeAck.draft)
        let remoteID = UUID()
        let remoteRemove = NativeVisitOperation.single(
            .init(
                intent: .init(target: beforeAck.target(), edit: .remove), before: before, after: nil))
        let bytes = try remoteRemove.commandBytes(
            id: remoteID, createdAtMs: NativeVisitDraft.milliseconds(Date()))
        let remoteResult = try await cloud.submit(.init(id: remoteID, bytes: bytes, attempts: 0))
        #expect(remoteResult.status == .accepted)
        let conflicted = try await sync.synchronize()
        #expect(conflicted.needsDecision && conflicted.pendingCount == 1)
        let review = try await repository.reviewConflict(conflictID)
        #expect(review.sites.count == 1 && review.sites.first?.remote == nil)
        #expect(review.sites.first?.local?.happenedAtMs == local.draft?.happenedAtMs)
        #expect(review.localPlan.manuallyRecreatedSiteIDs == [park.siteID.rawValue])
        #expect(review.sites.first?.proposed?.id != before.id)
        await #expect(throws: NativeVisitRecovery.Failure.missingVisitNeedsPermission) {
            try await repository.resolveConflict(review, choice: .keepLocal(allowManualRecreation: false))
        }
        setFailure(true)
        await #expect(throws: (any Error).self) {
            try await repository.resolveConflict(review, choice: .keepLocal(allowManualRecreation: true))
        }
        setFailure(false)
        #expect(try await store.visitQueue().map(\.id) == [conflictID])
        let resolution = try await repository.resolveConflict(
            review, choice: .keepLocal(allowManualRecreation: true))
        #expect(resolution.replacementIDs == review.localPlan.operations.map(\.id))
        #expect(resolution.replacementIDs.first != conflictID)
        await #expect(throws: (any Error).self) {
            try await repository.resolveConflict(review, choice: .keepRemote)
        }
        #expect(try await sync.synchronize().pendingCount == 0)
        let recovered = try await repository.workingState(park: park)
        #expect(recovered.visitID == review.sites.first?.proposed?.id)
        #expect(recovered.draft?.verified == false)
        #expect(recovered.draft?.happenedAtMs == local.draft?.happenedAtMs)
        #expect(try await store.nativeProgress()?.sites == 1)
        // The history feed can arrive before the marker feed after another device edits.
        // That is a normal overlap, not corrupt storage or permission to borrow revisions.
        var newer = try #require(recovered.draft)
        let recoveredBefore = newer
        newer.happenedAtMs -= 60_000
        let remoteDateID = UUID()
        let remoteDate = NativeVisitOperation.single(
            .init(
                intent: .init(
                    target: recovered.target(),
                    edit: .changeDate(happenedAtMs: newer.happenedAtMs, timeZone: newer.timeZone)),
                before: recoveredBefore, after: newer))
        let dateBytes = try remoteDate.commandBytes(
            id: remoteDateID, createdAtMs: NativeVisitDraft.milliseconds(Date()))
        #expect(
            try await cloud.submit(.init(id: remoteDateID, bytes: dateBytes, attempts: 0)).status == .accepted
        )
        _ = try await repository.history()
        #expect(
            try await store.nativeVisitWorkingState(
                siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue
            ).needsDetail)
        let refreshed = try await repository.workingState(park: park)
        #expect(!refreshed.needsDetail && refreshed.draft == newer)
    }
}
