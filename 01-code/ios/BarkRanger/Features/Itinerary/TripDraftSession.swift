import BarkDomain
import Foundation
import Observation

/// One editable draft and its last saved base. A write may advance the base, never replace newer edits.
@MainActor @Observable final class TripDraftSession {
    typealias Checkpoint = (NativeTripRepository, TripDraft, TripDraft?) async throws -> TripDraft

    private let account: AccountSession
    private let checkpointDraft: Checkpoint
    private(set) var draft: TripDraft?
    private(set) var revision = 0
    private(set) var pending = false
    var conflict = false
    // One feedback channel preserves ordering between editor actions and asynchronous save results.
    var notice: String?
    var isWriting: Bool { checkpoint != nil }
    var needsRetry: Bool { pending && !isWriting && !conflict }

    private var base: TripDraft?
    private var successNotice: String?
    private var checkpoint: Task<Void, Never>?
    private var generation = UUID()

    /// Last-resort memory recovery when the device refuses a checkpoint. This is
    /// not a second editor and cannot be presented in a different account scope.
    struct Recovery {
        let draft: TripDraft
        let base: TripDraft?
        let conflict: Bool
    }
    var recovery: Recovery? {
        guard pending, let draft else { return nil }
        return Recovery(draft: draft, base: base, conflict: conflict)
    }
    func restore(_ recovery: Recovery) {
        open(recovery.draft, replacing: recovery.base)
        pending = true
        conflict = recovery.conflict
        notice = "Unsaved edits were retained in memory. Retry saving before closing the app."
    }

    init(account: AccountSession, checkpointDraft: @escaping Checkpoint) {
        self.account = account
        self.checkpointDraft = checkpointDraft
    }

    /// The editor gates ordinary opens while pending; explicit reload/reset can discard that buffer.
    func open(_ draft: TripDraft, replacing base: TripDraft?) {
        reset()
        self.draft = draft
        self.base = base
    }

    /// Receives an already validated edit. Mutation rules and route-plan invalidation stay in the editor.
    func replace(_ draft: TripDraft, success: String?) {
        self.draft = draft
        notice = nil
        successNotice = success
        requestCheckpoint()
    }

    func acceptSaved(_ saved: TripDraft) {
        draft = saved
        base = saved
    }

    func waitForCheckpoint() async { await checkpoint?.value }

    func requestCheckpoint() {
        guard draft != nil else { return }
        revision += 1
        pending = true
        guard checkpoint == nil, let repository = account.nativeTrips?.repository else { return }
        let generation = generation
        let scope = account.tripScope
        checkpoint = Task {
            defer { if self.generation == generation { checkpoint = nil } }
            while let draft, !Task.isCancelled {
                let version = revision
                do {
                    guard self.generation == generation else { return }
                    let saved = try await checkpointDraft(repository, draft, base)
                    guard !Task.isCancelled, self.generation == generation,
                        self.draft?.id == draft.id
                    else { return }
                    base = saved
                    self.draft?.nativeBase = saved.nativeBase
                    if version == revision {
                        pending = false
                        if scope == account.tripScope, let successNotice { notice = successNotice }
                        successNotice = nil
                        return
                    }
                } catch {
                    if !Task.isCancelled, self.generation == generation {
                        conflict = error is TripDayEdit.Failure
                        notice =
                            conflict
                            ? "This draft changed on the map. Reopen it from Trips before continuing."
                            : "The draft has not been saved. Free storage or retry before leaving this editor."
                    }
                    return
                }
            }
        }
    }

    func reset() {
        revision += 1
        generation = UUID()
        checkpoint?.cancel()
        checkpoint = nil
        draft = nil
        base = nil
        pending = false
        conflict = false
        notice = nil
        successNotice = nil
    }
}
