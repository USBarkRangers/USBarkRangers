import BarkDomain
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Uses the real native writer/lifecycle, with networking off and a separate Firebase app.
/// No legacy account blob or mocked sync engine is kept to support current feature tests.
@MainActor struct NativeOfflineAccountFixture {
    let directory: URL
    let app: FirebaseApp
    let db: Firestore
    let auth: SyntheticAuth
    let session: AccountSession

    static func make(
        uid: String = "a", mapStyle: NativeProfile.MapStyle = .default,
        capabilities: AccountCapabilities = .editableTest, signIn: Bool = true
    ) async throws -> Self {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await NativeStore.open(directory: directory, project: "demo-bark-native", uid: uid)
        try await store.acceptProfile(.init(revision: 1, displayName: "Ranger \(uid)", mapStyle: mapStyle))
        try await store.seedPremium()
        await store.close()
        let (app, _, db) = try AccountAssembly.nativeProfileEmulator(scope: UUID())
        let auth = SyntheticAuth()
        let configuration = NativeProfileConfiguration(
            project: "demo-bark-native",
            connect: {
                try AccountAssembly.nativeProfileEmulatorClient(app: app, uid: $0)
            })
        let session = AccountSession(
            auth: auth, directory: directory, capabilities: capabilities,
            nativeProfileConfiguration: configuration)
        let fixture = Self(directory: directory, app: app, db: db, auth: auth, session: session)
        session.setForeground(true)
        if signIn {
            auth.select(uid)
            try await eventually { session.nativeTrips != nil && session.profileState?.confirmed != nil }
        } else {
            try await eventually { session.identity == nil && session.nativeTrips != nil }
        }
        return fixture
    }

    func close() async throws {
        await session.stopAndWait()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        try FileManager.default.removeItem(at: directory)
    }
}

extension NativeStore {
    func seedPremium() throws {
        if try profileView().confirmed == nil {
            try acceptProfile(.init(revision: 1, displayName: "Ranger"))
        }
        try acceptEntitlement(
            .init(
                revision: 1, premium: true, source: .production,
                validUntilMs: Int64(Date().addingTimeInterval(3600).timeIntervalSince1970 * 1000)))
    }
}
