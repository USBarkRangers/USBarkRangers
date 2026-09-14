import BarkDomain
import Foundation

/// Account-scoped current-visit workflows. The store owns atomic edits; this boundary
/// loads a missing selected event without loading the user's archive or requesting GPS.
nonisolated struct NativeVisitRepository: Sendable {
    let store: NativeStore
    let cloud: NativeVisitCloud?

    @concurrent func workingState(park: Park) async throws -> NativeVisitWorkingState {
        try Task.checkCancellation()
        var state = try await store.nativeVisitWorkingState(
            siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue)
        // A concurrent remote replacement can change the active ID during a fetch.
        // Retry one new selected ID, then surface change instead of chasing indefinitely.
        for _ in 0..<2 where state.needsDetail {
            guard let cloud, let id = state.visitID else { throw NativeStore.Failure.unavailable }
            let snapshot = try await cloud.visit(id: id, officialPlaceID: state.officialPlaceID)
            try Task.checkCancellation()
            try await store.acceptNativeVisit(snapshot)
            state = try await store.nativeVisitWorkingState(
                siteID: park.siteID.rawValue, officialPlaceID: park.id.rawValue)
        }
        guard !state.needsDetail else { throw NativeStore.Failure.unavailable }
        return state
    }
    @concurrent func mark(park: Park, fix: LocationFix? = nil) async throws {
        try Task.checkCancellation()
        if fix != nil { _ = try await workingState(park: park) }
        try Task.checkCancellation()
        _ = try await store.markNativeVisit(park: park, fix: fix)
    }
    @concurrent func changeDate(selected: NativeVisitWorkingState, date: Date, timeZone: TimeZone)
        async throws
    {
        try Task.checkCancellation()
        _ = try await store.changeNativeVisitDate(selected: selected, date: date, timeZone: timeZone)
    }
    @concurrent func remove(_ selected: [NativeVisitWorkingState]) async throws {
        try Task.checkCancellation()
        _ = try await store.removeNativeVisits(selected: selected)
    }
    @concurrent func history(before cursor: NativeVisitPage.Cursor? = nil) async throws -> NativeVisitPage {
        try Task.checkCancellation()
        guard let cloud else { throw NativeStore.Failure.unavailable }
        let page = try await cloud.history(before: cursor)
        try Task.checkCancellation()
        try await store.acceptNativeVisitHistory(page, after: cursor)
        // Keep the server cursor even if newer marker facts filter some cached rows.
        // A cache budget is never an archive limit or evidence that paging is complete.
        return page
    }
}
