import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

struct TripLibraryPagingTests {
    @Test func sharedRowsPreferDraftsAndKeepTheRepositoryPageOrder() throws {
        let saved = try ["newest", "b", "a"].map {
            try #require(nativeTripSnapshot(Trip(id: $0, name: $0), revision: 1).metadata)
        }
        let local = NativeStore.TripLists(
            drafts: [.init(id: "a", title: "Unsaved edits", dayCount: 1, stopCount: 0)],
            pending: [], conflicts: [])
        let content = TripLibraryContent(local: local, saved: saved)
        #expect(content.rows.map(\.id) == ["a", "newest", "b"])
        #expect(content.rows.first?.name == "Unsaved edits")
        #expect(content.saved.allSatisfy { $0.contentRevision == 1 })
    }
}
