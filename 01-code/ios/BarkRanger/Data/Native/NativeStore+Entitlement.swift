import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func readEntitlement() throws -> NativeEntitlement? {
        try requireOpen()
        guard let row = try entitlementRow() else { return nil }
        let value = try JSONDecoder().decode(NativeEntitlement.self, from: row.payload)
        try value.validate()
        guard value.revision == row.revision else { throw Failure.corrupt }
        return value
    }

    func acceptEntitlement(_ value: NativeEntitlement) throws {
        try requireOpen()
        try value.validate()
        do {
            if let current = try readEntitlement(), current.revision >= value.revision {
                guard current.revision > value.revision || current == value else { throw Failure.corrupt }
                return
            }
            let bytes = try JSONEncoder().encode(value)
            if let row = try entitlementRow() {
                row.revision = value.revision
                row.payload = bytes
            } else {
                modelContext.insert(NativeLocalSchema.Entitlement(revision: value.revision, payload: bytes))
            }
            try stageAuthorizedRetries(value)
            try commitProfileChange()
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    /// Previously rejected paid commands keep their exact IDs, dates and bytes.
    /// Only one walk may be uncertain at once, including after renewal.
    func resumeAuthorizedSubmissions() throws {
        try requireOpen()
        if try stageAuthorizedRetries(readEntitlement()) { try commitProfileChange() }
    }
    @discardableResult private func stageAuthorizedRetries(_ value: NativeEntitlement?) throws -> Bool {
        guard value?.permitsEditing(at: Date()) == true else { return false }
        let rejected = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.state == "rejected" && $0.failureCode == "premium-required" },
            sortBy: [SortDescriptor(\.sequence)])
        let rows = try modelContext.fetch(rejected)
        guard !rows.isEmpty else { return false }
        let uncertain = FetchDescriptor<NativeLocalSchema.PendingOperation>(
            predicate: #Predicate { $0.entityKey == "expedition" && $0.state == "sealed" })
        var walkInFlight = try modelContext.fetchCount(uncertain) > 0
        var changed = false
        for row in rows {
            if row.entityKey == "expedition", walkInFlight { continue }
            guard row.sealedBytes != nil else { throw Failure.corrupt }
            if row.entityKey == "expedition" { walkInFlight = true }
            row.state = "sealed"
            row.failureCode = nil
            row.nextAttemptAt = Date()
            changed = true
        }
        return changed
    }

    private func entitlementRow() throws -> NativeLocalSchema.Entitlement? {
        var query = FetchDescriptor<NativeLocalSchema.Entitlement>()
        query.fetchLimit = 2
        let rows = try modelContext.fetch(query)
        guard rows.count <= 1, rows.first == nil || rows.first?.key == "entitlement" else {
            throw Failure.corrupt
        }
        return rows.first
    }
}
