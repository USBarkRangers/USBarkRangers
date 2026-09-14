import Foundation
import Testing

@testable import BarkRanger

@MainActor struct LeaderboardTests {
    @Test func fiveLeadersAndPersonalStandingReuseTheSessionWithoutPaging() async throws {
        let fixture = try await BoardFixture.make()
        let model = fixture.model
        model.loadIfNeeded()
        model.loadIfNeeded()
        try await eventually { model.loaded && !model.loading }
        #expect(model.entries.count == 5 && model.personal?.rank == 42)
        #expect(model.personal?.entry.id == "self" && !model.isInTopFive)
        model.cancel()
        model.loadIfNeeded()
        #expect(await fixture.reader.topCalls == 1)
        #expect(await fixture.reader.personalCalls == ["self"])
        model.refresh()
        try await eventually { !model.loading }
        #expect(await fixture.reader.topCalls == 2)
        await fixture.close()
    }

    @Test func userInTopFiveNeedsNoDuplicateRowOrExtraPersonalRead() async throws {
        let fixture = try await BoardFixture.make(uid: "leader-2")
        fixture.model.loadIfNeeded()
        try await eventually { fixture.model.loaded }
        #expect(fixture.model.isInTopFive && fixture.model.personal?.rank == 2)
        #expect(await fixture.reader.personalCalls.isEmpty)
        await fixture.close()
    }

    @Test func partialFailureKeepsLeadersAndRefreshFailureKeepsLastSnapshot() async throws {
        let fixture = try await BoardFixture.make()
        await fixture.reader.failPersonal()
        fixture.model.loadIfNeeded()
        try await eventually { fixture.model.loaded && !fixture.model.loading }
        #expect(fixture.model.entries.count == 5 && fixture.model.personalUnavailable)
        #expect(fixture.model.notice != nil && fixture.model.personal == nil)
        let entries = fixture.model.entries
        await fixture.reader.failTop()
        fixture.model.refresh()
        try await eventually { !fixture.model.loading }
        #expect(fixture.model.entries == entries && fixture.model.notice != nil)
        await fixture.close()
    }

    @Test func cancelledPersonalLookupRetriesAndOldAccountCompletionCannotPublish() async throws {
        let fixture = try await BoardFixture.make()
        await fixture.reader.holdPersonal()
        fixture.model.loadIfNeeded()
        try await eventually { await fixture.reader.waiting("self") }
        fixture.model.cancel()
        #expect(!fixture.model.loaded)
        await fixture.reader.finish("self")
        fixture.model.loadIfNeeded()
        try await eventually { await fixture.reader.waiting("self") }
        fixture.auth.select("other")
        try await eventually { fixture.account.identity?.uid == "other" }
        fixture.model.resetScope()
        fixture.model.loadIfNeeded()
        try await eventually { await fixture.reader.waiting("other") }
        await fixture.reader.finish("self")
        await Task.yield()
        #expect(fixture.model.personal == nil && fixture.model.loading)
        await fixture.reader.finish("other")
        try await eventually { fixture.model.loaded && !fixture.model.loading }
        #expect(fixture.model.personal?.entry.id == "other")
        await fixture.close()
    }

    @Test func missingStandingAndEmptyBoardDoNotInventAPosition() async throws {
        let fixture = try await BoardFixture.make()
        await fixture.reader.setEmpty()
        fixture.model.loadIfNeeded()
        try await eventually { fixture.model.loaded && !fixture.model.loading }
        #expect(fixture.model.entries.isEmpty && fixture.model.personal == nil)
        #expect(fixture.model.notice == nil && !fixture.model.personalUnavailable)
        let missing = LeaderboardModel(repository: nil, account: fixture.account)
        missing.loadIfNeeded()
        #expect(missing.notice != nil && !missing.loading)
        await fixture.close()
    }
}

@MainActor private struct BoardFixture {
    let directory: URL
    let auth: SyntheticAuth
    let account: AccountSession
    let reader: ControlledBoard
    let model: LeaderboardModel
    static func make(uid: String = "self") async throws -> Self {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let auth = SyntheticAuth()
        let account = AccountSession(
            auth: auth, cloud: nil, directory: directory, capabilities: .editableTest)
        account.start()
        auth.select(uid)
        try await eventually { account.identity?.uid == uid && account.state != nil }
        let reader = ControlledBoard()
        return Self(
            directory: directory, auth: auth, account: account, reader: reader,
            model: LeaderboardModel(repository: reader, account: account))
    }
    func close() async {
        model.cancel()
        await account.stopAndWait()
        try? FileManager.default.removeItem(at: directory)
    }
}

private actor ControlledBoard: LeaderboardReading {
    private(set) var topCalls = 0
    private(set) var personalCalls: [String] = []
    private var topFailure = false
    private var personalFailure = false
    private var empty = false
    private var holding = false
    private var pending: [String: CheckedContinuation<LeaderboardRepository.Standing?, Never>] = [:]
    func failTop() { topFailure = true }
    func failPersonal() { personalFailure = true }
    func setEmpty() { empty = true }
    func holdPersonal() { holding = true }
    func waiting(_ uid: String) -> Bool { pending[uid] != nil }
    func finish(_ uid: String) { pending.removeValue(forKey: uid)?.resume(returning: own(uid)) }
    func topFive() throws -> [LeaderboardRepository.Entry] {
        topCalls += 1
        if topFailure { throw URLError(.notConnectedToInternet) }
        return empty ? [] : (1...5).map { .init(id: "leader-\($0)", name: "Ranger \($0)", points: 100 - $0) }
    }
    func standing(uid: String) async throws -> LeaderboardRepository.Standing? {
        personalCalls.append(uid)
        if personalFailure { throw URLError(.cannotConnectToHost) }
        if holding { return await withCheckedContinuation { pending[uid] = $0 } }
        return empty ? nil : own(uid)
    }
    private func own(_ uid: String) -> LeaderboardRepository.Standing {
        .init(entry: .init(id: uid, name: uid, points: 10), rank: 42)
    }
}
