import BarkDomain
import Foundation

extension NativeVisitRepository {
    /// Explicit full export, streamed a page at a time to a temporary file. Normal
    /// Passport/map use never runs this archive traversal. Pending authored choices
    /// are captured once and overlay the corresponding confirmed site, including removal.
    @concurrent func exportCSV(parks: [Park]) async throws -> URL {
        guard let cloud else { throw NativeStore.Failure.unavailable }
        let pending = try await store.visitExportChanges()
        let revision = try await cloud.progress().progress?.revision
        let names = Dictionary(
            parks.map { ($0.id.rawValue, $0.name) }, uniquingKeysWith: { first, _ in first })
        let url = URL.temporaryDirectory.appendingPathComponent("Bark-Ranger-\(UUID().uuidString).csv")
        do {
            try Data(VisitCSV.header.utf8).write(to: url, options: [.atomic, .completeFileProtection])
            let file = try FileHandle(forWritingTo: url)
            defer { try? file.close() }
            try file.seekToEnd()
            var cursor: NativeVisitPage.Cursor?
            repeat {
                try Task.checkCancellation()
                let page = try await cloud.history(before: cursor)
                for record in page.items where pending[record.siteID] == nil {
                    if let visit = NativeVisitDraft(record: record) {
                        try file.write(
                            contentsOf: VisitCSV.row(visit, parkName: names[visit.officialPlaceID]))
                    }
                }
                cursor = page.next
            } while cursor != nil
            for change in pending.values.sorted(by: { $0.intent.target.siteID < $1.intent.target.siteID }) {
                if let visit = change.after {
                    try file.write(contentsOf: VisitCSV.row(visit, parkName: names[visit.officialPlaceID]))
                }
            }
            // Date changes also advance progress revision. Reject a moving archive
            // rather than presenting a multi-page partial export as a complete one.
            guard try await cloud.progress().progress?.revision == revision else {
                throw NativeStore.Failure.unavailable
            }
            try Task.checkCancellation()
            try file.synchronize()
            return url
        } catch {
            try? FileManager.default.removeItem(at: url)
            throw error
        }
    }
}
extension NativeStore {
    func visitExportChanges() throws -> [String: NativeVisitChange] {
        var changes: [String: NativeVisitChange] = [:]
        for entry in try visitQueue() {
            for change in try visitOperation(entry.id).changes {
                changes[change.intent.target.siteID] = change
            }
        }
        return changes
    }
}
