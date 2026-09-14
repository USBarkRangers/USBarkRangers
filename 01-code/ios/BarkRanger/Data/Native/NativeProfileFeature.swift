import BarkDomain
import Foundation

/// A resource of AccountSession, not a second account/identity owner. The session
/// alone controls admission, publication and account transitions.
nonisolated struct NativeProfileConfiguration: Sendable {
    let project: String
    let connect: @MainActor @Sendable (String) throws -> NativeProfileCloud
    var connectTrips: (@MainActor @Sendable (String) throws -> NativeTripCloud)? = nil
    var connectVisits: (@MainActor @Sendable (String) throws -> NativeVisitCloud)? = nil
    var connectExpeditions: (@MainActor @Sendable (String) throws -> NativeExpeditionCloud)? = nil
    var connectLeaderboard: (@MainActor @Sendable (String) throws -> NativeLeaderboardRepository)? = nil
    var connectSavedPins: (@MainActor @Sendable (String) throws -> NativeSavedPinCloud)? = nil
    var deleteAccount: (@MainActor @Sendable (String) async throws -> Void)? = nil
    var forgetDeletedIdentity: (@MainActor @Sendable (String) throws -> Void)? = nil
}

nonisolated struct NativeProfileFeature: Sendable {
    let uid: String
    let store: NativeStore
    let sync: NativeProfileSync

    @MainActor static func open(
        configuration: NativeProfileConfiguration, directory: URL, uid: String
    ) async throws -> Self {
        let cloud = try configuration.connect(uid)
        do {
            let store = try await NativeStore.open(
                directory: directory, project: configuration.project, uid: uid)
            return .init(uid: uid, store: store, sync: NativeProfileSync(store: store, cloud: cloud))
        } catch {
            await cloud.close()
            throw error
        }
    }
    func saveName(_ name: String) async throws {
        try Task.checkCancellation()
        try await store.saveProfileEdit(.displayName(name.trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    func saveAppearance(_ style: NativeProfile.MapStyle) async throws {
        try Task.checkCancellation()
        try await store.saveProfileEdit(.mapStyle(style))
    }
    func close() async {
        await sync.stop()
        await store.close()
    }
}
