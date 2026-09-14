import Foundation

public struct NativeVisitSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let visitID: String
    public let officialPlaceID: String
    public let siteID: String
    public let visit: NativeVisitRecord?
    public let placeProgress: NativePlaceProgress?
    public let progress: NativeProgress?
    public let readTime: NativeServerTime
    public func validate() throws {
        guard version == 1 else { throw NativeRecordValidation.Failure.malformed }
        try NativeRecordValidation.identifier(visitID)
        try NativeRecordValidation.identifier(officialPlaceID)
        try NativeRecordValidation.identifier(siteID)
        try visit?.validate()
        try placeProgress?.validate()
        try progress?.validate()
        if let visit {
            guard visit.id == visitID, visit.officialPlaceID == officialPlaceID, visit.siteID == siteID,
                visit.updatedAt <= readTime
            else { throw NativeRecordValidation.Failure.malformed }
            if !visit.deleted {
                guard placeProgress?.visitID == visitID, placeProgress?.visitRevision == visit.revision,
                    placeProgress?.verified == visit.details?.verified
                else {
                    throw NativeRecordValidation.Failure.malformed
                }
            }
        }
        if let placeProgress {
            guard placeProgress.id == siteID, placeProgress.updatedAt <= readTime,
                placeProgress.visitID != visitID || visit?.deleted == false
            else {
                throw NativeRecordValidation.Failure.malformed
            }
        }
        if let progress, progress.updatedAt > readTime { throw NativeRecordValidation.Failure.malformed }
    }
}

public struct NativeProgressSnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let progress: NativeProgress?
    public let readTime: NativeServerTime
    public func validate() throws {
        guard version == 1 else { throw NativeRecordValidation.Failure.malformed }
        try progress?.validate()
        if let progress, progress.updatedAt > readTime { throw NativeRecordValidation.Failure.malformed }
    }
}
