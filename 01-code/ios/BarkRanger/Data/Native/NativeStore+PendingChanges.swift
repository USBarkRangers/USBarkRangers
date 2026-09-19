import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    struct PendingChange: Identifiable, Equatable, Sendable {
        let id: UUID
        let title: String
        let detail: String
        let createdAt: Date
        let state: String
        let failure: String?
        let isSavedPin: Bool
        /// Mirrors `reviewPendingDiscard`: never-sent work, or a refused saved pin.
        var canDiscard: Bool { state == "queued" || (state == "rejected" && isSavedPin) }
        var status: String {
            if failure == "premium-required" { return "Waiting for Premium renewal" }
            if failure == "intent-expired" { return "Older than 45 days · retained for review" }
            switch state {
            case "queued": return "Saved on iPhone · not sent"
            case "sealed": return "Waiting for server confirmation"
            default:
                return isSavedPin
                    ? "Not accepted by the server · discard to edit this pin again"
                    : "Needs review · saved on iPhone"
            }
        }
    }

    /// Called only when Pending Changes opens. Trip descriptions use their small
    /// summary, never route/note bodies. No cloud reads or feature navigation.
    func pendingChanges() throws -> [PendingChange] {
        try requireOpen()
        var query = FetchDescriptor<NativeLocalSchema.PendingOperation>(sortBy: [SortDescriptor(\.sequence)])
        query.propertiesToFetch = [
            \.id, \.entityKey, \.sequence, \.createdAtMs, \.state, \.failureCode, \.listSummary,
        ]
        return try modelContext.fetch(query).map { row in
            guard let id = UUID(uuidString: row.id) else { throw Failure.corrupt }
            let title: String
            let detail: String
            switch row.entityKey {
            case "profile":
                let edit = try JSONDecoder().decode(NativeProfileEdit.self, from: row.intent)
                switch edit {
                case .bootstrap:
                    title = "Create account profile"
                    detail = "Initial profile"
                case .displayName(let name):
                    title = "Display name"
                    detail = name
                case .mapStyle(let style):
                    title = "Map appearance"
                    detail = style == .satellite ? "Satellite" : "Standard"
                }
            case "visits":
                let value = try visitOperation(id)
                let names = value.changes.compactMap { ($0.after ?? $0.before)?.name }
                detail =
                    names.prefix(3).joined(separator: ", ")
                    + (names.count > 3 ? " and \(names.count - 3) more" : "")
                if value.isBulk {
                    title = "Remove \(names.count) visits"
                } else if let edit = value.changes.first?.intent.edit {
                    switch edit {
                    case .mark: title = "Mark park visit"
                    case .changeDate: title = "Change visit date"
                    case .remove: title = "Remove visit"
                    }
                } else {
                    throw Failure.corrupt
                }
            case "expedition":
                let value = try expeditionOperation(id)
                switch value.action {
                case .record(let walk):
                    title = "Save walk"
                    detail = String(format: "%.2f miles · %@", walk.meters / 1609.344, walk.source.rawValue)
                case .assign(let trail, _, _, _):
                    title = "Choose expedition"
                    detail = trail
                case .edit(_, _, _, _, let name):
                    title = "Edit walk"
                    detail = name
                case .remove:
                    title = "Remove walk"
                    detail = value.beforeActivity?.trailName ?? "Recorded activity"
                case .claim:
                    title = "Complete expedition"
                    detail = "Server validates completion and points"
                }
            default:
                if row.entityKey.hasPrefix("savedPin:"), let bytes = row.listSummary {
                    let value = try JSONDecoder().decode(SavedPinSummary.self, from: bytes)
                    title = value.saved ? "Save pin" : "Remove saved pin"
                    detail = value.title
                    break
                }
                guard row.entityKey.hasPrefix("trip:"), let bytes = row.listSummary else {
                    throw Failure.corrupt
                }
                let value = try JSONDecoder().decode(NativeTripListItem.self, from: bytes)
                title = value.deleted ? "Delete trip" : "Save trip changes"
                detail = value.title.isEmpty ? "Trip" : value.title
            }
            return .init(
                id: id, title: title, detail: detail,
                createdAt: Date(timeIntervalSince1970: Double(row.createdAtMs) / 1000),
                state: row.state, failure: row.failureCode,
                isSavedPin: row.entityKey.hasPrefix("savedPin:"))
        }
    }
}
