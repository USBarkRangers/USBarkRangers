import BarkDomain
import Foundation

/// Device-only full-read stamp. Metadata revision covers notes too; content revision
/// alone cannot prove that the downloaded notes are current. Authored draft bases are separate.
/// Stored separately from itinerary bytes so library metadata never decodes trip detail.
nonisolated struct NativeTripCacheStamp: Codable {
    let metadata: NativeTripMetadata?
    let readTime: NativeServerTime

    init(_ snapshot: NativeTripSnapshot, previousReadTime: NativeServerTime? = nil) {
        metadata = snapshot.metadata
        readTime = max(snapshot.readTime, previousReadTime ?? snapshot.readTime)
    }
}
