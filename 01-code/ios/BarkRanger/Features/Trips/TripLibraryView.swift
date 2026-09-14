import BarkDomain
import SwiftUI

/// Existing draft/account lists become a switching sheet. All trip data and actions stay in the editor.
struct TripLibraryView: View {
    let model: TripEditorModel
    @State private var discarding: NativeTripRepository.DeletionSelection?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let content = model.library
        NavigationStack {
            List {
                Section {
                    if model.canEdit {
                        Button("New trip", systemImage: "plus") {
                            if model.newTrip() { dismiss() }
                        }.disabled(!model.canChangeTrip)
                    }
                    if model.account.identity == nil {
                        Text("Drafts stay on this iPhone. Sign in with Premium to save to your account.")
                            .font(.footnote)
                    }
                }
                if let notice = model.notice { Section { Text(notice).font(.footnote) } }
                Section("Drafts on this iPhone") {
                    ForEach(content.drafts) { row in
                        Button {
                            model.selectTrip(row.id) { dismiss() }
                        } label: {
                            tripLabel(row.id, title: row.title, detail: row.detail)
                        }
                        .disabled(!model.canChangeTrip)
                        .swipeActions {
                            if model.canEdit {
                                Button("Discard trip", role: .destructive) {
                                    Task { discarding = await model.reviewDeletion(row.id) }
                                }
                                .disabled(!model.canChangeTrip)
                            }
                        }
                    }
                }
                if !content.saved.isEmpty {
                    Section("Saved to your account") {
                        ForEach(content.saved) { row in
                            Button {
                                model.selectTrip(row.id) { dismiss() }
                            } label: {
                                tripLabel(row.id, title: row.title, detail: row.detail)
                            }
                            .disabled(!model.canChangeTrip)
                            .swipeActions {
                                if model.canUsePremium {
                                    Button("Discard trip", role: .destructive) {
                                        Task { discarding = await model.reviewDeletion(row.id) }
                                    }
                                    .disabled(!model.canChangeTrip)
                                }
                            }
                        }
                    }
                }
                if model.account.nativeTrips?.hasMore == true || model.account.nativeTrips?.message != nil {
                    Section {
                        if let message = model.account.nativeTrips?.message { Text(message).font(.footnote) }
                        if model.account.nativeTrips?.hasMore == true {
                            Button(
                                model.account.nativeTrips?.loading == true
                                    ? "Loading trips…" : "Load more trips"
                            ) {
                                model.account.nativeTrips?.loadMore()
                            }.disabled(model.account.nativeTrips?.loading == true)
                                .accessibilityIdentifier("load-more-trips")
                        }
                    }
                }
                if !model.conflicts.isEmpty {
                    Section("Changes needing attention") {
                        ForEach(model.conflicts, id: \.self) { id in
                            TripConflictReviewView(id: id, model: model)
                        }
                    }
                }
            }
            .accessibilityIdentifier("trip-switcher")
            .navigationTitle("Switch trip").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.disabled(model.saving)
                }
            }
        }.interactiveDismissDisabled(model.saving)
            .alert(
                "Discard this trip?",
                isPresented: Binding(
                    get: { discarding != nil }, set: { if !$0 { discarding = nil } }
                ), presenting: discarding
            ) { selection in
                Button("Cancel", role: .cancel) { discarding = nil }
                Button("Discard trip", role: .destructive) {
                    discarding = nil
                    model.discardTrip(selection)
                }
            } message: { _ in
                Text(
                    "This removes the trip from this iPhone and, if saved, your account. This cannot be undone."
                )
            }
            .onChange(of: model.account.identity?.uid) { _, _ in discarding = nil }
    }

    private func tripLabel(_ id: String, title: String, detail: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).foregroundStyle(.primary)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if id == model.draft?.id { Image(systemName: "checkmark").accessibilityLabel("Current trip") }
        }.accessibilityIdentifier("switch-trip-\(id)")
    }
}

private struct TripConflictReviewView: View {
    let id: String
    let model: TripEditorModel
    @State private var review: NativeTripRepository.ConflictReview?
    @State private var failure = false
    @State private var refresh = UUID()
    var body: some View {
        Group {
            Text("A trip changed on another device, or access changed. Your local draft is retained.")
                .font(.footnote)
            if let review {
                Text(
                    review.snapshot.metadata?.deleted != false
                        ? "The account trip was deleted. Retrying preserves your work as a new trip."
                        : "Account version: \(review.snapshot.metadata?.title ?? "Trip")"
                )
                .font(.footnote)
                Button("Use account version") { model.resolve(review, keepLocal: false) }
                    .disabled(model.isWorking)
                Button("Retry local version") { model.resolve(review, keepLocal: true) }
                    .disabled(!model.canUsePremium || model.isWorking)
            } else {
                Text(
                    failure
                        ? "Connect to review the account version. Your draft is safe."
                        : "Loading current version…"
                )
                .font(.footnote)
            }
            Button("Reload account version") { refresh = UUID() }.disabled(model.isWorking)
        }.task(id: refresh) {
            review = nil
            do {
                guard let repository = model.account.nativeTrips?.repository else { return }
                let value = try await repository.reviewConflict(id)
                try Task.checkCancellation()
                review = value
                failure = false
            } catch { if !Task.isCancelled { failure = true } }
        }
    }
}
