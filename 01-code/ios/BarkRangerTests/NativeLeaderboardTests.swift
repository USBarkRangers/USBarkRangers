import FirebaseCore
import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

/// Real SDK reads against the seeder's fixed, legacy-shaped published standings. Never production.
@MainActor struct NativeLeaderboardTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] == "1"))
    func publishedScoresLoadFiveWithSeparatePersonalRankAndTies() async throws {
        let folder = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let scope = UUID()
        let assembly = AccountAssembly.emulator(directory: folder, scope: scope)
        let app = try #require(FirebaseApp.app(name: "BarkEmulator-\(scope.uuidString)"))
        let db = Firestore.firestore(app: app)
        let board = try #require(assembly.leaderboard)
        let leaders = try await board.topFive()
        #expect(leaders.map(\.points) == [500, 400, 300, 200, 100])
        #expect(leaders.first?.name == "Trailblazer")
        let personal = try #require(try await board.standing(uid: "native-test-b"))
        #expect(personal.rank == 7 && personal.entry.points == 50)
        #expect(try await board.standing(uid: "native-board-tied")?.rank == 7)
        #expect(try await board.standing(uid: "native-board-missing") == nil)
        let published = try await db.collection("leaderboard").document("native-board-first")
            .getDocument(source: .server)
        #expect(
            published.data()?["rankPoints"] == nil,
            "Existing totalPoints-only records must work without a migration or score write")
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        try? FileManager.default.removeItem(at: folder)
    }
}
