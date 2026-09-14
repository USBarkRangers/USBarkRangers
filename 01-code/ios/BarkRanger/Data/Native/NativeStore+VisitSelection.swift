import BarkDomain
import Foundation
import SwiftData

extension NativeStore {
    func acceptNativeVisitSelection(_ selection: NativeVisitSelection, requested: [NativeVisitReference])
        throws
    {
        try requireOpen()
        try selection.validate(for: requested)
        do {
            try stageVisitSelection(selection)
            try stageVisitCacheRetention()
            try commit()
            publish(Set(requested.map { .visit($0.visitID) }).union([.progress, .markers, .visitHistory]))
        } catch {
            modelContext.rollback()
            throw error
        }
    }
    func stageVisitSelection(_ selection: NativeVisitSelection) throws {
        let visitIDs = Set(selection.visits.map(\.id))
        let siteIDs = Set(selection.places.map(\.id))
        for visit in selection.visits { try stageVisit(visit) }
        for marker in selection.places { try stagePlaceProgress(marker) }
        for reference in selection.requests {
            if !visitIDs.contains(reference.visitID), let row = try visitRow(reference.visitID),
                try decodeVisit(row).updatedAt <= selection.readTime
            {
                modelContext.delete(row)
            }
            if !siteIDs.contains(reference.siteID),
                let marker = try nativePlaceProgress(siteID: reference.siteID),
                marker.updatedAt <= selection.readTime
            {
                throw Failure.unavailable
            }
        }
        try stageProgress(selection.progress, readTime: selection.readTime)
    }
}
