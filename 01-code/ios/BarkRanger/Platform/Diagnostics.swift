import Foundation
import OSLog

/// Local logs accept fixed event names only: no URLs, account IDs or user text.
nonisolated struct Diagnostics: Sendable {
    enum Event: String {
        case enteredForeground, enteredBackground, unsupportedLink
        case routeCacheReadFailed, routeCacheWriteFailed, routeCacheCleanupDeferred
    }

    enum Operation: String {
        case shellStartup, catalogLocalReady, catalogLoaderDismissed
    }

    private let logger = Logger(subsystem: "swarm.USBARKRANGERS", category: "Shell")
    enum CatalogStage: String, Sendable {
        case cacheRead, bundleRead, localValidation, manifest, payload, commit
    }
    enum CatalogFailure: String, Sendable {
        case decoding, metadata, hash, identity, fields, links, removedIdentity, revision
        case deadline, response, size, network, retryAfter, storage, cancelled, unknown
    }
    private let catalogLogger = Logger(subsystem: "swarm.USBARKRANGERS", category: "Catalog")
    private let catalogSink: (@Sendable (CatalogStage, CatalogFailure) -> Void)?
    enum AccountStage: String, Sendable {
        case openStore, readStore, submit, acknowledge, readCloud, saveSnapshot, removeAccountData
    }
    enum AccountFailure: String, Sendable {
        case cancelled, accountChanged, denied, network, decoding, storage, unavailable, rejected, unknown
    }
    private let accountLogger = Logger(subsystem: "swarm.USBARKRANGERS", category: "Account")
    private let accountSink: (@Sendable (AccountStage, AccountFailure) -> Void)?
    private let enabled: Bool

    init(
        enabled: Bool = true,
        catalogSink: (@Sendable (CatalogStage, CatalogFailure) -> Void)? = nil,
        accountSink: (@Sendable (AccountStage, AccountFailure) -> Void)? = nil
    ) {
        self.accountSink = accountSink
        self.enabled = enabled
        self.catalogSink = catalogSink
    }
    func catalogFailure(_ reason: CatalogFailure, at stage: CatalogStage) {
        catalogSink?(stage, reason)
        guard enabled else { return }
        catalogLogger.notice(
            "failure stage=\(stage.rawValue, privacy: .public) reason=\(reason.rawValue, privacy: .public)")
    }

    func accountFailure(_ error: any Error, at stage: AccountStage) {
        let reason = Self.accountReason(error)
        accountSink?(stage, reason)
        guard enabled, reason != .cancelled else { return }
        accountLogger.notice(
            "failure stage=\(stage.rawValue, privacy: .public) reason=\(reason.rawValue, privacy: .public)")
    }
    static func accountReason(_ error: any Error) -> AccountFailure {
        switch error {
        case is CancellationError: return .cancelled
        case is DecodingError, NativeStore.Failure.corrupt: return .decoding
        case NativeStore.Failure.wrongScope, NativeProfileCloud.Failure.accountChanged: return .accountChanged
        case NativeStore.Failure.unavailable: return .denied
        case is NativeStore.Failure: return .storage
        case is NativeCallableTransport.ServerFailure: return .rejected
        default: break
        }
        let value = error as NSError
        if value.domain == NSURLErrorDomain {
            return value.code == NSURLErrorCancelled ? .cancelled : .network
        }
        if value.domain == NSCocoaErrorDomain { return .storage }
        // SDK domains/codes only; underlying descriptions, URLs and user fields never enter the log.
        if ["FIRFirestoreErrorDomain", "com.firebase.functions"].contains(value.domain) {
            if [7, 16].contains(value.code) { return .denied }
            if [4, 14].contains(value.code) { return .network }
        }
        return .unknown
    }

    func record(_ event: Event) {
        guard enabled else { return }
        logger.info("\(event.rawValue, privacy: .public)")
    }

    /// A monotonic, synchronous boundary; preserves the operation's return/error.
    func measure<Value>(_ operation: Operation, action: () throws -> Value) rethrows -> Value {
        let clock = ContinuousClock()
        let start = clock.now
        defer {
            if enabled {
                let elapsed = start.duration(to: clock.now)
                logger.info(
                    "\(operation.rawValue, privacy: .public) duration=\(String(describing: elapsed), privacy: .public)"
                )
            }
        }
        return try action()
    }
    func duration(_ operation: Operation, milliseconds: Double) {
        guard enabled else { return }
        logger.info("\(operation.rawValue, privacy: .public) milliseconds=\(milliseconds, privacy: .public)")
    }

}
