import BarkDomain
import Foundation
import Synchronization
import Testing

@testable import BarkRanger

@MainActor
struct CatalogDiagnosticsTests {
    @Test func corruptCacheIsDiagnosedButMissingCacheIsNormal() async throws {
        let events = Mutex<[(Diagnostics.CatalogStage, Diagnostics.CatalogFailure)]>([])
        let diagnostics = Diagnostics(enabled: false) { stage, reason in
            events.withLock { $0.append((stage, reason)) }
        }
        let context = try DiscoveryTestContext()
        defer { context.close() }
        _ = context.disk.loadCandidates(diagnostics: diagnostics)
        #expect(events.withLock { $0.isEmpty })
        try FileManager.default.createDirectory(at: context.disk.directory, withIntermediateDirectories: true)
        try Data("corrupt cached envelope".utf8).write(
            to: context.disk.directory.appendingPathComponent("current.json"))
        let repository = CatalogRepository(disk: context.disk, client: nil, diagnostics: diagnostics)
        let state = await repository.loadLocal()
        #expect(state.snapshot?.parks.count == 393 && state.source == .bundle)
        #expect(events.withLock { $0.count == 1 && $0.first?.0 == .cacheRead && $0.first?.1 == .decoding })
    }

    @Test(arguments: ["hash-mismatch", "shrunk", "throttled"])
    func rejectionReasonsPreserveTheSameUserFallback(_ scenario: String) async throws {
        let events = Mutex<[(Diagnostics.CatalogStage, Diagnostics.CatalogFailure)]>([])
        let diagnostics = Diagnostics(enabled: false) { stage, reason in
            events.withLock { $0.append((stage, reason)) }
        }
        let context = try DiscoveryTestContext()
        defer { context.close() }
        let client = CatalogHTTPClient(
            manifestURL: try #require(URL(string: "http://127.0.0.1:8787/\(scenario)/manifest.json")))
        let repository = CatalogRepository(disk: context.disk, client: client, diagnostics: diagnostics)
        let local = await repository.loadLocal()
        await repository.refresh(reason: .startup)
        let state = await repository.current()
        #expect(state.status == .unavailable && state.snapshot?.revision == local.snapshot?.revision)
        let expected: Diagnostics.CatalogFailure =
            scenario == "shrunk" ? .removedIdentity : scenario == "throttled" ? .retryAfter : .hash
        #expect(events.withLock { $0.last?.1 == expected })
        #expect(events.withLock { $0.last?.0 == (scenario == "throttled" ? .manifest : .payload) })
    }

    @Test func commitFailureAndCancellationAreDistinguished() async throws {
        let events = Mutex<[(Diagnostics.CatalogStage, Diagnostics.CatalogFailure)]>([])
        let diagnostics = Diagnostics(enabled: false) { stage, reason in
            events.withLock { $0.append((stage, reason)) }
        }
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try Data("blocks directory".utf8).write(to: context.disk.directory)
        let client = CatalogHTTPClient(
            manifestURL: try #require(URL(string: "http://127.0.0.1:8787/valid/manifest.json")))
        let repository = CatalogRepository(disk: context.disk, client: client, diagnostics: diagnostics)
        await repository.refresh(reason: .startup)
        #expect(await repository.current().source == .bundle)
        #expect(events.withLock { $0.last?.0 == .commit && $0.last?.1 == .storage })
        let stalled = CatalogRepository(
            disk: context.disk,
            client: CatalogHTTPClient(
                manifestURL: try #require(URL(string: "http://127.0.0.1:8787/stalled/manifest.json"))),
            diagnostics: diagnostics)
        let task = Task { await stalled.refresh(reason: .startup) }
        try await eventually { await stalled.current().status == .checking }
        await stalled.cancelRefresh()
        await task.value
        #expect(await stalled.current().status == .saved)
        #expect(events.withLock { $0.last?.1 == .cancelled })
    }

    @Test func errorNamesStayBoundedAndNeverExposeUnderlyingErrorText() {
        let events = Mutex<[Diagnostics.CatalogFailure]>([])
        let diagnostics = Diagnostics(enabled: false) { _, reason in events.withLock { $0.append(reason) } }
        let errors: [any Error] = [
            URLError(.notConnectedToInternet), CatalogHTTPClient.Failure.deadline,
            CatalogHTTPClient.Failure.response, NSError(domain: "sensitive-url-or-user-text", code: 123),
        ]
        for error in errors {
            diagnostics.catalogFailure(CatalogRepository.failureReason(error, at: .payload), at: .payload)
        }
        #expect(events.withLock { $0 == [.network, .deadline, .response, .unknown] })
    }
}
