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
            try commitProfileChange()
        } catch {
            modelContext.rollback()
            throw error
        }
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
