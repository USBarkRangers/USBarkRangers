import BarkDomain
import SwiftUI

struct PendingChangesView: View {
    let model: AccountModel
    private var session: AccountSession { model.session }
    @State private var items: [NativeStore.PendingChange] = []
    @State private var review: NativeStore.PendingDiscard?
    @State private var confirming = false
    @State private var message: String?
    @State private var loaded = false
    @State private var ownerUID: String?
    private var scopedItems: [NativeStore.PendingChange] {
        ownerUID == session.nativeProfile?.uid ? items : []
    }
    private var discardWarning: String {
        if scopedItems.first(where: { $0.id == review?.rootID })?.resumesWithAccess == true {
            return "This change can still sync if Premium is restored. Discarding it is permanent."
                + ((review?.ids.count ?? 0) > 1 ? " Later changes that depend on it are removed too." : "")
        }
        return "This also removes later changes that depend on this one."
            + (review?.retainsTripDraft == true
                ? " Your trip editor draft is kept; only its queued saves are cancelled." : "")
    }

    var body: some View {
        List {
            Section {
                Text(
                    "Changes save on this iPhone first and sync automatically when connected. Keep the app installed while changes are pending."
                )
                .font(.footnote)
                Button("Sync now") { session.requestSync(refresh: true) }
                if let access = session.entitlement.access, access.premium, let until = access.validUntil {
                    accountValue(
                        "Offline editing available until",
                        value: until.formatted(date: .abbreviated, time: .shortened))
                }
                if scopedItems.count >= NativeSyncPolicy.queueWarning {
                    Text(
                        "Many changes are waiting. Sync when connected, or discard never-sent changes you no longer need. New park visits and recorded walks can still be saved."
                    )
                    .font(.footnote).foregroundStyle(.orange)
                }
                if let message { Text(message).font(.footnote) }
                if let message = session.message { Text(message).font(.footnote) }
            }
            if !loaded {
                ProgressView("Reading saved changes…")
            } else if scopedItems.isEmpty {
                Text("No pending changes")
            }
            if let profile = session.profileState, profile.conflict {
                Section { AccountProfileConflict(model: model, reviewed: profile) }
            }
            AccountActionFeedback(model: model)
            ForEach(scopedItems) { item in
                Section {
                    Text(item.title).font(.headline)
                    Text(item.detail)
                    Text(item.status).font(.footnote).foregroundStyle(.secondary)
                    Text(item.createdAt, format: .dateTime.month().day().hour().minute()).font(.caption)
                    if item.canDiscard {
                        Button("Discard", role: .destructive) {
                            Task {
                                do {
                                    guard let feature = session.nativeProfile else { return }
                                    let value = try await feature.store.reviewPendingDiscard(item.id)
                                    guard session.nativeProfile?.uid == feature.uid else { return }
                                    review = value
                                    confirming = true
                                } catch {
                                    message = "This change can no longer be discarded. Nothing was removed."
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Pending changes")
        .disabled(model.busy).onDisappear { model.cancel() }
        .confirmationDialog(
            "Discard these changes?", isPresented: $confirming, titleVisibility: .visible
        ) {
            Button("Discard \(review?.ids.count ?? 0) changes", role: .destructive) {
                guard let review, let feature = session.nativeProfile, ownerUID == feature.uid else { return }
                Task {
                    do {
                        try await feature.store.discardPending(review)
                        if session.nativeProfile?.uid == feature.uid { message = nil }
                    } catch {
                        if session.nativeProfile?.uid == feature.uid {
                            message =
                                "Nothing was discarded. A change was sent or edited after you reviewed it."
                        }
                    }
                }
            }
        } message: {
            Text(discardWarning)
        }
        .task(id: session.nativeProfile?.uid) {
            items = []
            loaded = false
            ownerUID = session.nativeProfile?.uid
            review = nil
            confirming = false
            message = nil
            guard let feature = session.nativeProfile else { return }
            do {
                for await _ in try await feature.store.changes(matching: [.pending]) {
                    let value = try await feature.store.pendingChanges()
                    guard !Task.isCancelled, session.nativeProfile?.uid == feature.uid else { return }
                    items = value
                    loaded = true
                }
            } catch {
                if !Task.isCancelled {
                    message = "Pending changes could not be read. Your files are retained."
                }
            }
        }
    }
}
