import BarkDomain
import SwiftUI

/// Choice binds the exact displayed local/server versions and operation group.
struct VisitConflictView: View {
    let model: PassportModel
    let id: UUID
    @State private var review: NativeStore.VisitConflictReview?
    @State private var failure = false
    @State private var refresh = UUID()
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let review {
                ForEach(review.sites, id: \.siteID) { site in
                    Text(site.local?.name ?? site.remote?.name ?? "Saved visit").font(.subheadline.bold())
                    Text(description("On this iPhone", site.local)).font(.footnote)
                    Text(description("Account", site.remote)).font(.footnote)
                }
                let recreated = !review.localPlan.manuallyRecreatedSiteIDs.isEmpty
                if recreated {
                    Text("The account visit was removed. Keeping your work creates a new manual visit, without reusing old location evidence.")
                        .font(.footnote)
                }
                Button("Use account version") { model.resolve(review, keepLocal: false) }.disabled(model.working)
                if model.canEdit {
                    Button(recreated ? "Restore as new manual visit" : "Retry my visit changes") {
                        model.resolve(review, keepLocal: true, allowManualRecreation: recreated)
                    }.disabled(model.working)
                }
            } else {
                Text(failure ? "Connect to review these changes. Your local work is retained." : "Loading account version…")
                    .font(.footnote)
            }
            Button("Reload account version") { refresh = UUID() }.disabled(model.working)
        }
        .task(id: "\(model.account.nativeVisits?.scope ?? ""):\(id):\(refresh)") {
            review = nil
            failure = false
            do {
                guard let repository = model.account.nativeVisits?.repository else { return }
                let value = try await repository.reviewConflict(id)
                try Task.checkCancellation()
                review = value
            } catch { if !Task.isCancelled { failure = true } }
        }
    }
    private func description(_ label: String, _ visit: NativeVisitDraft?) -> String {
        guard let visit else { return "\(label): removed" }
        return "\(label): \(visit.happenedAt.formatted(date: .abbreviated, time: .omitted)), \(visit.verified ? "proximity check-in" : "manual visit")"
    }
}
