import BarkDomain
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeLeaderboardFeatureTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func realAccountBoardUsesPublicIdentityAndDoesNotReadPrivateUserDocuments() async throws {
        let f = try await NativeAdventureAppFixture.make()
        do {
            let park = try #require(await f.context.catalog.current().snapshot?.parks.first)
            try await f.visits.repository.mark(park: park)
            try await f.settle()
            let model = f.passport.leaderboard
            model.loadIfNeeded()
            try await eventually(timeout: .seconds(15)) { model.loaded && !model.loading }
            #expect(!model.entries.isEmpty && model.entries.count <= 5 && model.notice == nil)
            #expect(model.currentUserID != f.uid && model.currentUserID?.count == 64)
            #expect(model.personal?.entry.id == model.currentUserID && model.personal?.entry.points == 1)
            #expect((model.personal?.rank ?? 0) > 0)
            let board = try #require(f.session.nativeLeaderboard)
            await #expect(throws: NativeCallableTransport.Failure.invalidReply) {
                try await board.standing(uid: "someone-else")
            }
            await f.close()
        } catch {
            await f.close()
            throw error
        }
    }
}
