import BarkDomain
import Foundation
import Observation

/// One active account lifetime. UID changes clear presentation before any asynchronous close/open work.
@MainActor @Observable final class AccountSession {
    private(set) var identity: AccountIdentity?
    private(set) var state: PersonalState?
    private(set) var message: String?
    private(set) var isSyncing = false
    private(set) var profile: ProfileRepository?
    let entitlement = EntitlementRepository()
    let auth: (any AccountAuthenticating)?
    let cloud: (any CloudUserTransport)?
    private let directory: URL
    private var store: LocalStore?
    private var engine: SyncEngine?
    private var authTask: Task<Void, Never>?
    private var scopeTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var pausing: Task<Void, Never>?
    private var syncRequested = false
    private var generation = UUID()
    private var foreground = false
    private var connected = false
    init(auth: (any AccountAuthenticating)?, cloud: (any CloudUserTransport)?, directory: URL) {
        self.auth = auth
        self.cloud = cloud
        self.directory = directory
    }
    func start() {
        guard authTask == nil, let auth else { return }
        authTask = Task { [weak self] in
            for await identity in auth.changes() {
                guard !Task.isCancelled else { return }
                self?.activate(identity)
            }
        }
    }
    private func activate(_ next: AccountIdentity?, force: Bool = false) {
        if !force, identity?.uid == next?.uid {
            identity = next
            if next?.serverConfirmed == true { requestSync() }
            return
        }
        generation = UUID()
        let generation = generation
        let oldStore = store
        let oldEngine = engine
        let previousTask = scopeTask
        scopeTask?.cancel()
        syncTask?.cancel()
        syncTask = nil
        retryTask?.cancel()
        retryTask = nil
        syncRequested = false
        identity = next
        state = nil
        profile = nil
        store = nil
        engine = nil
        entitlement.update(nil)
        message = nil
        isSyncing = false
        scopeTask = Task { [weak self] in
            await previousTask?.value
            await oldEngine?.stop()
            await oldStore?.close()
            guard let self, let next, !Task.isCancelled, generation == self.generation else { return }
            do {
                let store = try await LocalStore.open(directory: self.directory, uid: next.uid)
                guard !Task.isCancelled, self.generation == generation else {
                    await store.close()
                    return
                }
                self.store = store
                self.profile = ProfileRepository(store: store)
                if let cloud = self.cloud {
                    self.engine = SyncEngine(store: store, cloud: cloud, uid: next.uid)
                }
                self.requestSync()
                for await state in try await store.updates() {
                    guard !Task.isCancelled, self.generation == generation else { return }
                    let newIntents = Set(state.pending.map(\.id)).subtracting(
                        self.state?.pending.map(\.id) ?? [])
                    self.state = state
                    self.entitlement.update(state.baseline)
                    if !newIntents.isEmpty { self.requestSync() }
                }
            } catch {
                if !Task.isCancelled, self.generation == generation {
                    self.message =
                        "Your saved account data could not be opened. It has been kept for recovery."
                }
            }
        }
    }
    func connectivityChanged(_ connected: Bool) {
        self.connected = connected
        if connected { requestSync() } else { pauseSync() }
    }
    func setForeground(_ foreground: Bool) {
        self.foreground = foreground
        if foreground {
            start()
            requestSync()
        } else {
            pauseSync()
        }
    }
    private func pauseSync() {
        syncTask?.cancel()
        syncTask = nil
        retryTask?.cancel()
        retryTask = nil
        isSyncing = false
        syncRequested = false
        let previous = pausing
        let engine = engine
        pausing = Task {
            await previous?.value
            await engine?.pause()
        }
    }
    func requestSync() {
        guard foreground, connected, identity != nil, let engine else { return }
        syncRequested = true
        guard syncTask == nil else { return }
        retryTask?.cancel()
        retryTask = nil
        let generation = generation
        let pausing = pausing
        syncTask = Task { [weak self] in
            await pausing?.value
            guard let self, !Task.isCancelled, self.generation == generation else { return }
            self.isSyncing = true
            repeat {
                self.syncRequested = false
                if self.identity?.serverConfirmed != true {
                    do { try await self.auth?.reload() } catch { break }
                }
                guard !Task.isCancelled, self.generation == generation else { return }
                guard self.identity?.serverConfirmed == true else { break }
                let success = await engine.flush()
                guard !Task.isCancelled, self.generation == generation else { return }
                self.message =
                    success
                    ? nil
                    : "Cloud sync is unavailable. Your saved data and pending changes are safe on this iPhone."
            } while self.syncRequested
            guard !Task.isCancelled, self.generation == generation else { return }
            let delay = await engine.nextDelay()
            guard !Task.isCancelled, self.generation == generation else { return }
            self.isSyncing = false
            self.syncTask = nil
            self.retryTask = Task { [weak self] in
                do { try await Task.sleep(for: delay) } catch { return }
                guard let self, self.generation == generation else { return }
                self.requestSync()
            }
        }
    }
    func eraseDeletedAccount(uid: String) async throws {
        // A later account must never be closed or erased by an earlier deletion completion.
        guard identity?.uid == uid || identity == nil else { throw AccountFailure.accountChanged }
        activate(nil, force: true)
        let generation = generation
        let closing = scopeTask
        await closing?.value
        if self.generation == generation { scopeTask = nil }
        try await LocalStore.removeAccount(directory: directory, uid: uid)
    }
    func retryStorage() { activate(identity, force: true) }
    func waitForSync() async {
        requestSync()
        await syncTask?.value
    }
    func stopAndWait() async {
        foreground = false
        authTask?.cancel()
        authTask = nil
        pauseSync()
        activate(nil, force: true)
        await scopeTask?.value
        await pausing?.value
        scopeTask = nil
        pausing = nil
    }
}
