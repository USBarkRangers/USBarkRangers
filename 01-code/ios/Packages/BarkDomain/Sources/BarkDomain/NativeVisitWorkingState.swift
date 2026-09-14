import Foundation

/// A single site's current local intent, not a fabricated server-confirmed visit.
/// Capture this value with a date/removal selection so a later read cannot silently
/// change the event or revisions the person chose to edit.
public struct NativeVisitWorkingState: Equatable, Sendable {
    public let officialPlaceID: String
    public let siteID: String
    public let visitID: String?
    public let visitRevision: Int64
    public let placeRevision: Int64
    public let draft: NativeVisitDraft?
    public let pendingOperationID: UUID?
    public let needsDecision: Bool

    public var needsDetail: Bool { visitID != nil && draft == nil }
    public init(
        officialPlaceID: String, siteID: String, visitID: String?, visitRevision: Int64,
        placeRevision: Int64, draft: NativeVisitDraft?, pendingOperationID: UUID?, needsDecision: Bool
    ) {
        self.officialPlaceID = officialPlaceID
        self.siteID = siteID
        self.visitID = visitID
        self.visitRevision = visitRevision
        self.placeRevision = placeRevision
        self.draft = draft
        self.pendingOperationID = pendingOperationID
        self.needsDecision = needsDecision
    }
    public func target(newID: String = UUID().uuidString.lowercased()) -> NativeVisitIntent.Target {
        .init(
            visitID: visitID ?? newID, officialPlaceID: officialPlaceID, siteID: siteID,
            visitRevision: visitRevision, placeRevision: placeRevision)
    }
}
