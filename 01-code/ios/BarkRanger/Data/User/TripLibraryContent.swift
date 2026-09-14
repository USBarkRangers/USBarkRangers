import BarkDomain
import Foundation

/// Read-only row metadata shared by both switchers. No second trip/draft dataset or selected identity.
nonisolated struct TripLibraryContent: Equatable, Sendable {
    struct Row: Identifiable, Equatable, Sendable {
        let id: String
        let name: String
        let isDraft: Bool
        let detail: String
        var contentRevision: Int64? = nil
        var title: String { name.isEmpty ? "Untitled trip" : name }
        var label: String { title + (isDraft ? " · Draft" : "") }
    }
    var drafts: [Row] = []
    var saved: [Row] = []
    var rows: [Row] { drafts + saved }

    init() {}
    init(drafts: [Row], saved: [Row]) {
        self.drafts = drafts
        self.saved = saved
    }
    init(local: NativeStore.TripLists, saved: [NativeTripMetadata]) {
        let deleted = Set(local.pending.filter(\.deleted).map(\.id))
        drafts = local.drafts.filter { !deleted.contains($0.id) }.map {
            Row(
                id: $0.id, name: $0.title, isDraft: true,
                detail: "\($0.dayCount) days · \($0.stopCount) stops")
        }
        let ids = Set(drafts.map(\.id)).union(deleted)
        self.saved = saved.filter { !ids.contains($0.id) }.map {
            Row(
                id: $0.id, name: $0.title ?? "Saved trip", isDraft: false,
                detail: "Saved itinerary", contentRevision: $0.contentRevision)
        }
    }
}
