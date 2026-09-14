import BarkDomain
import SwiftUI

struct ExpeditionConflictView: View {
    let id: UUID
    let model: ExpeditionModel
    @State private var review: NativeStore.ExpeditionConflictReview?
    @State private var failed = false
    @State private var refresh = UUID()
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Walk sync needs review").font(.headline)
            if let review {
                Text("These related changes are saved on this iPhone:").font(.footnote)
                ForEach(review.entries) { entry in
                    Text(description(entry.operation)).font(.footnote)
                }
                if let remote = review.remote.activity?.details {
                    Text("Account: \(remote.trailName) · \(remote.miles, specifier: "%.2f") miles").font(
                        .footnote)
                } else if review.remote.activityID != nil {
                    Text("This walk is not in the current account history.").font(.footnote)
                }
                if let active = review.remote.runs.first(where: { $0.id == review.remote.state?.activeRunID })
                {
                    Text("Current account trail: \(active.name)").font(.footnote)
                }
                if review.replacements != nil {
                    Button("Keep these local changes") { model.resolve(review, keepLocal: true) }.disabled(
                        !model.canEdit)
                } else {
                    Text(
                        "These changes cannot be safely reapplied as recorded. They remain on this iPhone unless you discard them. Walks are never moved to another trail automatically."
                    ).font(.footnote)
                }
                Button("Discard these local changes", role: .destructive) { confirmDiscard = true }.disabled(
                    model.busy)
                Button("Refresh review") { refresh = UUID() }.disabled(model.busy)
            } else if failed {
                Text("The account could not be checked. Your local changes are retained.").font(.footnote)
                Button("Try again") { refresh = UUID() }
            } else {
                ProgressView("Checking account…")
            }
        }.barkSectionCard()
            .task(id: "\(model.account.nativeExpeditions?.scope ?? ""):\(id):\(refresh)") {
                review = nil
                failed = false
                confirmDiscard = false
                guard let repository = model.account.nativeExpeditions?.repository else { return }
                do {
                    let value = try await repository.reviewConflict(id)
                    guard !Task.isCancelled else { return }
                    review = value
                } catch { if !Task.isCancelled { failed = true } }
            }
            .confirmationDialog(
                "Discard the listed local changes?", isPresented: $confirmDiscard, titleVisibility: .visible
            ) {
                Button("Discard listed changes", role: .destructive) {
                    if let review { model.resolve(review, keepLocal: false) }
                }
            } message: {
                Text(
                    "Confirmed account history is kept. This removes only the listed pending changes from this iPhone."
                )
            }
    }
    @State private var confirmDiscard = false
    private func description(_ value: NativeExpeditionOperation) -> String {
        switch value.action {
        case .record(let summary):
            return
                "Record \(value.recordedTrailName ?? "walk") · \(String(format: "%.2f", summary.meters / 1609.344)) miles"
        case .edit(_, _, let meters, let date, let name):
            let day = Date(timeIntervalSince1970: Double(date) / 1000).formatted(
                date: .abbreviated, time: .shortened)
            return "Correct \(name) · \(String(format: "%.2f", meters / 1609.344)) miles · \(day)"
        case .remove: return "Remove \(value.beforeActivity?.trailName ?? "walk")"
        case .assign(let id, _, _, _):
            return "Start \(model.trails.first(where: { $0.id == id })?.name ?? "trail")"
        case .claim: return "Confirm trail completion"
        }
    }
}
