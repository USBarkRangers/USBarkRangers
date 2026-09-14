import Foundation

/// Availability only. SavedRecord and TripDraft remain the owners of trip content.
public struct TripLibraryState: Codable, Equatable, Sendable {
    public var recentIDs: [String]
    public var hasMore: Bool
    public init(recentIDs: [String] = [], hasMore: Bool = true) {
        self.recentIDs = recentIDs
        self.hasMore = hasMore
    }
}
