import BarkDomain
import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeExpeditionEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"))
    func offlineAssignWalkClaimNextTrailReplaysThroughTheRealSDK() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(
            "BarkPhase5-recording-\(UUID().uuidString)")
        let scope = UUID()
        let assembly = AccountAssembly.emulator(directory: folder, scope: scope)
        let session = assembly.session
        session.setForeground(true)
        session.connectivityChanged(true)
        let auth = try #require(session.auth)
        try await auth.email("ranger-a@example.test", password: "BarkTest123!", create: false)
        try await eventually(timeout: .seconds(20)) {
            session.state?.baseline.confirmedAt != nil && session.dataAccess.canEditAccount
        }
        session.setForeground(false)
        session.connectivityChanged(false)
        let repository = try #require(session.expeditions)
        let previousPoints = session.state?.visible.profile.fields["walkPoints"]?.number ?? 0
        let first = UUID().uuidString.lowercased()
        let next = UUID().uuidString.lowercased()
        try await repository.apply(
            action: "assign",
            payload: .object(["trailID": .string("angels_landing"), "runID": .string(first)]))
        let now = Date()
        let walk = WalkSummary(
            source: .manual, startedAt: now, endedAt: now, meters: 5 * 1609.344, elapsedSeconds: 0,
            runID: first)
        try await repository.commitWalk(walk)
        try await repository.apply(action: "claim", payload: .object(["runID": .string(first)]))
        try await repository.apply(
            action: "assign", payload: .object(["trailID": .string("emerald_lake"), "runID": .string(next)]))
        try await eventually { session.state?.pending.count == 4 }
        #expect(Expedition(profile: session.state?.visible.profile ?? .init()).runID == next)
        session.setForeground(true)
        session.connectivityChanged(true)
        try await eventually(timeout: .seconds(25)) { session.state?.pending.isEmpty == true }
        let confirmed = try #require(session.state?.baseline.profile)
        #expect(Expedition(profile: confirmed).runID == next)
        #expect(Expedition(profile: confirmed).history.contains { $0.id == walk.id })
        #expect(confirmed.fields["walkPoints"]?.number == previousPoints + 1)
        await session.stopAndWait()
        if let app = FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)") {
            try await Firestore.firestore(app: app).terminate()
            _ = await app.delete()
        }
    }
}
