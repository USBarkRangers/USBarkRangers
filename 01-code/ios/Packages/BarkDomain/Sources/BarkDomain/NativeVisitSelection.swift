import Foundation

public struct NativeVisitReference: Codable, Equatable, Hashable, Sendable {
    public let visitID: String
    public let officialPlaceID: String
    public let siteID: String
    public init(visitID: String, officialPlaceID: String, siteID: String) {
        self.visitID = visitID
        self.officialPlaceID = officialPlaceID
        self.siteID = siteID
    }
    public init(target: NativeVisitIntent.Target) {
        self.init(visitID: target.visitID, officialPlaceID: target.officialPlaceID, siteID: target.siteID)
    }
    public func validate() throws {
        try NativeRecordValidation.identifier(visitID)
        try NativeRecordValidation.identifier(officialPlaceID)
        try NativeRecordValidation.identifier(siteID)
    }
}
/// One consistent selected-set read for bulk acknowledgment/recovery. Progress is
/// included once, never copied into every event; missing requested IDs mean absence.
public struct NativeVisitSelection: Codable, Equatable, Sendable {
    public let version: Int
    public let requests: [NativeVisitReference]
    public let visits: [NativeVisitRecord]
    public let places: [NativePlaceProgress]
    public let progress: NativeProgress?
    public let readTime: NativeServerTime
    public init(snapshot: NativeVisitSnapshot) throws {
        try snapshot.validate()
        version = snapshot.version
        requests = [
            .init(
                visitID: snapshot.visitID, officialPlaceID: snapshot.officialPlaceID, siteID: snapshot.siteID)
        ]
        visits = snapshot.visit.map { [$0] } ?? []
        places = snapshot.placeProgress.map { [$0] } ?? []
        progress = snapshot.progress
        readTime = snapshot.readTime
    }
    public func validate(for expected: [NativeVisitReference]) throws {
        guard version == 1, (1...500).contains(requests.count), requests.count == expected.count,
            Set(requests) == Set(expected), Set(requests.map(\.visitID)).count == requests.count,
            visits.count <= requests.count, places.count <= requests.count,
            Set(visits.map(\.id)).count == visits.count, Set(places.map(\.id)).count == places.count
        else { throw NativeRecordValidation.Failure.malformed }
        for request in requests { try request.validate() }
        let byID = Dictionary(uniqueKeysWithValues: requests.map { ($0.visitID, $0) })
        let bySite = Dictionary(uniqueKeysWithValues: places.map { ($0.id, $0) })
        let requestedSites = Set(requests.map(\.siteID))
        for place in places {
            try place.validate()
            guard requestedSites.contains(place.id), place.updatedAt <= readTime else {
                throw NativeRecordValidation.Failure.malformed
            }
        }
        for visit in visits {
            try visit.validate()
            guard let request = byID[visit.id], request.officialPlaceID == visit.officialPlaceID,
                request.siteID == visit.siteID, visit.updatedAt <= readTime
            else { throw NativeRecordValidation.Failure.malformed }
            if let details = visit.details {
                guard let place = bySite[visit.siteID], place.visitID == visit.id,
                    place.visitRevision == visit.revision, place.verified == details.verified
                else {
                    throw NativeRecordValidation.Failure.malformed
                }
            }
        }
        let available = Set(visits.filter { !$0.deleted }.map(\.id))
        for place in places {
            if let id = place.visitID, byID[id] != nil, !available.contains(id) {
                throw NativeRecordValidation.Failure.malformed
            }
        }
        try progress?.validate()
        if let progress, progress.updatedAt > readTime { throw NativeRecordValidation.Failure.malformed }
    }
}
