import BarkDomain
import Foundation
import Observation

/// One active account lifetime. UID changes clear presentation before any asynchronous close/open work.
@MainActor @Observable final class AccountSession {
    private(set) var identity: AccountIdentity?
    private(set) var state: PersonalState?
    // Temporary local data for not-yet-connected features stays separate. Native
    // profile/access is never copied into this old account-wide representation.
    private(set) var nativeProfile: NativeProfileFeature?
    private(set) var nativeTrips: NativeTripFeature?
    private(set) var nativeVisits: NativeVisitFeature?
    private(set) var nativeExpeditions: NativeExpeditionFeature?
    private(set) var nativeLeaderboard: NativeLeaderboardRepository?
    private var guestNativeStore: NativeStore?
    // Installed once by the shared editor. Capture/drain its old-scope checkpoint
    // before closing that writer; identity still clears synchronously below.
    var closeTripEditing: (() -> Task<Void, Never>)?
    var prepareTripIdentityChange: (() async throws -> Void)?
    var tripScope: String? { nativeTrips?.scope }
    private(set) var profileState: NativeStore.ProfileView?
    let nativeProfileConfiguration: NativeProfileConfiguration?
    private var profileObservation: Task<Void, Never>?
    private(set) var message: String?
    private(set) var isSyncing = false
    // Historical backend regression harness only. Shipping Map/Planner have no
    // legacy trip repository, list or paging path.
    #if DEBUG
        private(set) var isLoadingMoreTrips = false
        var hasMoreTrips: Bool { identity != nil && state?.tripLibrary?.hasMore == true }
        private(set) var trips: TripRepository?
        private var tripPageTask: Task<Void, Never>?
    #endif
    private(set) var tripLibraryMessage: String?
    private(set) var requiresStorageRecovery = false
    private(set) var profile: ProfileRepository?
    private(set) var visits: VisitRepository?
    private(set) var expeditions: ExpeditionRepository?
    let entitlement = EntitlementRepository()
    var dataAccess: AccountDataAccess {
        AccountDataAccess(entitlement: entitlement.access, isGuest: identity == nil && nativeTrips != nil)
    }
    let auth: (any AccountAuthenticating)?
    let cloud: (any CloudUserTransport)?
    let capabilities: AccountCapabilities
    private let diagnostics: Diagnostics
    let directory: URL
    private var store: LocalStore?
    private var engine: SyncEngine?
    private var authTask: Task<Void, Never>?
    private var scopeTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var pausing: Task<Void, Never>?
    private var syncRequested = false
    private var refreshRequested = false
    private var generation = UUID()
    private var foreground = false
    private var connected = false
    private var scopeStarted = false
    init(
        auth: (any AccountAuthenticating)?, cloud: (any CloudUserTransport)?, directory: URL,
        capabilities: AccountCapabilities = .init(), diagnostics: Diagnostics = Diagnostics(),
        nativeProfileConfiguration: NativeProfileConfiguration? = nil
    ) {
        self.capabilities = capabilities
        self.diagnostics = diagnostics
        self.auth = auth
        self.cloud = cloud
        self.directory = directory
        self.nativeProfileConfiguration = nativeProfileConfiguration
    }
    func start() {
        guard authTask == nil else { return }
        guard let auth else {
            if !scopeStarted { activate(nil) }
            return
        }
        authTask = Task { [weak self] in
            for await identity in auth.changes() {
                guard !Task.isCancelled else { return }
                self?.activate(identity)
            }
        }
    }
    private func activate(_ next: AccountIdentity?, force: Bool = false, openGuest: Bool = true) {
        if !force, scopeStarted, identity?.uid == next?.uid {
            let confirmed = identity?.serverConfirmed == true
            identity = next
            if !confirmed, next?.serverConfirmed == true { requestSync() }
            return
        }
        generation = UUID()
        scopeStarted = true
        let generation = generation
        let oldStore = store
        let oldEngine = engine
        let oldProfile = nativeProfile
        let tripEditingDrain = closeTripEditing?()
        let oldTrips = nativeTrips
        let oldVisits = nativeVisits
        nativeVisits = nil
        let oldExpeditions = nativeExpeditions
        nativeExpeditions = nil
        let oldLeaderboard = nativeLeaderboard
        nativeLeaderboard = nil
        let oldGuestStore = guestNativeStore
        nativeTrips = nil
        guestNativeStore = nil
        let oldProfileObservation = profileObservation
        profileObservation?.cancel()
        profileObservation = nil
        nativeProfile = nil
        profileState = nil
        let previousTask = scopeTask
        scopeTask?.cancel()
        syncTask?.cancel()
        syncTask = nil
        retryTask?.cancel()
        retryTask = nil
        #if DEBUG
            tripPageTask?.cancel()
            tripPageTask = nil
            isLoadingMoreTrips = false
            trips = nil
        #endif
        tripLibraryMessage = nil
        syncRequested = false
        refreshRequested = false
        identity = next
        state = nil
        profile = nil
        visits = nil
        expeditions = nil
        store = nil
        engine = nil
        entitlement.update(nil)
        message = nil
        requiresStorageRecovery = false
        isSyncing = false
        scopeTask = Task { [weak self] in
            await previousTask?.value
            await oldEngine?.stop()
            await oldProfileObservation?.value
            await tripEditingDrain?.value
            await oldTrips?.close()
            await oldVisits?.close()
            await oldExpeditions?.close()
            await oldLeaderboard?.close()
            await oldGuestStore?.close()
            await oldProfile?.close()
            await oldStore?.close()
            guard let self, !Task.isCancelled, generation == self.generation, next != nil || openGuest else {
                return
            }
            do {
                if let next, self.nativeProfileConfiguration != nil {
                    guard try await self.openNativeProfile(next, generation: generation) else { return }
                }
                if next == nil || self.nativeProfile != nil {
                    let project = self.nativeProfileConfiguration?.project ?? "bark-ranger-ios"
                    let nativeStore: NativeStore
                    if let profile = self.nativeProfile {
                        nativeStore = profile.store
                    } else {
                        nativeStore = try await NativeStore.open(
                            directory: self.directory, project: project, uid: "guest-drafts", guest: true)
                    }
                    let tripCloud = try next.flatMap {
                        try self.nativeProfileConfiguration?.connectTrips?($0.uid)
                    }
                    let feature = NativeTripFeature(
                        scope: project + ":" + (next?.uid ?? "guest-drafts"), store: nativeStore,
                        cloud: tripCloud)
                    do {
                        if let next {
                            try await NativeDraftHandoff.adopt(
                                directory: self.directory, project: project,
                                uid: next.uid, into: nativeStore)
                        } else {
                            try await NativeDraftHandoff.importEarlierGuestFiles(
                                directory: self.directory, into: nativeStore)
                        }
                        try await feature.start()
                    } catch {
                        await feature.close()
                        if next == nil { await nativeStore.close() }
                        throw error
                    }
                    guard !Task.isCancelled, self.generation == generation else {
                        await feature.close()
                        if next == nil { await nativeStore.close() }
                        return
                    }
                    if next == nil { self.guestNativeStore = nativeStore }
                    self.nativeTrips = feature
                    self.updateFeatureNetwork()
                }
                if let next, let profile = self.nativeProfile, let configuration = self.nativeProfileConfiguration {
                    let visits = NativeVisitFeature(scope: configuration.project + ":" + next.uid,
                        store: profile.store, cloud: try configuration.connectVisits?(next.uid),
                        refreshAccess: { [weak self] in self?.refreshNativeAccess() })
                    do { try await visits.start() } catch { await visits.close(); throw error }
                    guard !Task.isCancelled, self.generation == generation else {
                        await visits.close()
                        return
                    }
                    self.nativeVisits = visits
                    let walks = NativeExpeditionFeature(scope: configuration.project + ":" + next.uid,
                        store: profile.store, cloud: try configuration.connectExpeditions?(next.uid),
                        refreshAccess: { [weak self] in self?.refreshNativeAccess() })
                    do { try await walks.start() } catch { await walks.close(); throw error }
                    guard !Task.isCancelled, self.generation == generation else {
                        await walks.close()
                        return
                    }
                    self.nativeExpeditions = walks
                    self.nativeLeaderboard = try configuration.connectLeaderboard?(next.uid)
                    self.updateFeatureNetwork()
                    // All shipping personal features now use the scoped native writer.
                    // Do not open, observe or decode the transitional account graph.
                    return
                }
                // Guest planning is completely native and has no account graph.
                if next == nil, self.nativeTrips != nil { return }
                #if DEBUG
                // Historical regression fixtures only. This graph cannot be opened
                // by a Release build; native factories returned above.
                let signedInDirectory =
                    self.nativeProfileConfiguration.map {
                        self.directory.appendingPathComponent("native-feature-transition")
                            .appendingPathComponent($0.project)
                    } ?? self.directory
                // Guest planning has a separate local namespace, no Auth identity and no sync worker.
                let directory =
                    next == nil ? self.directory.appendingPathComponent("GuestDrafts") : signedInDirectory
                let store = try await LocalStore.open(
                    directory: directory, uid: next?.uid ?? "guest-drafts", isGuest: next == nil)
                guard !Task.isCancelled, self.generation == generation else {
                    await store.close()
                    return
                }
                if let next, self.nativeTrips == nil {
                    do {
                        try await GuestDraftHandoff.adopt(
                            directory: self.directory, uid: next.uid, into: store)
                    } catch {
                        if !Task.isCancelled, self.generation == generation {
                            self.diagnostics.accountFailure(error, at: .openStore)
                            self.message =
                                "Guest trips are retained for this account but could not be opened. Reopen the app to retry recovery."
                        }
                    }
                    guard !Task.isCancelled, self.generation == generation else {
                        await store.close()
                        return
                    }
                }
                self.store = store
                self.profile =
                    next != nil && self.capabilities.profileWrites && self.nativeProfileConfiguration == nil
                    ? ProfileRepository(store: store) : nil
                self.visits =
                    self.nativeVisits == nil && next != nil && self.capabilities.profileWrites
                    ? VisitRepository(store: store) : nil
                // Historical regression fixture only; no trip writer into the old graph in native mode.
                #if DEBUG
                    self.trips =
                        self.nativeTrips == nil && self.capabilities.profileWrites
                        ? TripRepository(store: store) : nil
                #endif
                self.expeditions =
                    next != nil && self.capabilities.profileWrites ? ExpeditionRepository(store: store) : nil
                if self.nativeProfileConfiguration == nil, let next, let cloud = self.cloud {
                    self.engine = SyncEngine(
                        store: store, cloud: cloud, uid: next.uid,
                        allowsMutations: self.capabilities.profileWrites, diagnostics: self.diagnostics,
                        observationFailed: { [weak self] delay in
                            Task { @MainActor in
                                guard let self, self.generation == generation else { return }
                                self.message =
                                    "Cloud sync is unavailable. Your saved data and pending changes are safe on this iPhone."
                                self.scheduleRetry(after: delay)
                            }
                        })
                }
                if self.nativeProfileConfiguration == nil { self.requestSync() }
                for await state in try await store.updates() {
                    guard !Task.isCancelled, self.generation == generation else { return }
                    let activeChanged = self.state?.selectedTripID != state.selectedTripID
                    let newIntents = Set(state.pending.map(\.id)).subtracting(
                        self.state?.pending.map(\.id) ?? [])
                    self.state = state
                    if self.nativeProfileConfiguration == nil {
                        self.entitlement.update(next == nil ? nil : state.baseline)
                    }
                    if self.nativeProfileConfiguration == nil, !newIntents.isEmpty { self.requestSync() }
                    if activeChanged, self.foreground, self.connected {
                        do { try await self.engine?.selectActiveTrip(state.selectedTripID) } catch {
                            guard !Task.isCancelled, self.generation == generation else { return }
                            self.diagnostics.accountFailure(error, at: .readCloud)
                            self.requestSync(refresh: true)
                        }
                    }
                }
                #else
                    throw NativeStore.Failure.unavailable
                #endif
            } catch {
                if !Task.isCancelled, self.generation == generation {
                    self.diagnostics.accountFailure(error, at: .openStore)
                    if self.nativeProfile != nil {
                        self.tripLibraryMessage =
                            self.nativeTrips == nil
                            ? "Trip storage could not be opened. Your saved files are retained; keep the app installed and retry."
                            : "Visit or walk storage could not be opened. Your files are retained; your profile and trips are available."
                        return
                    }
                    self.requiresStorageRecovery =
                        error is PersonalPayload.Failure
                        || (error as? LocalStore.Failure) == .corrupt
                    self.message =
                        self.requiresStorageRecovery
                        ? "Your saved account needs a compatible app update or recovery. Keep this app installed; your saved files have not been replaced."
                        : "Your saved account data could not be opened. It has been kept for recovery."
                }
            }
        }
    }
    /// The profile has no dependency on loading or decoding unconverted feature files.
    private func openNativeProfile(_ identity: AccountIdentity, generation: UUID) async throws -> Bool {
        guard let configuration = nativeProfileConfiguration else { return false }
        let feature = try await NativeProfileFeature.open(
            configuration: configuration, directory: directory, uid: identity.uid)
        guard !Task.isCancelled, self.generation == generation else {
            await feature.close()
            return false
        }
        nativeProfile = feature
        profileObservation = Task { [weak self] in
            do {
                for await value in try await feature.store.profileUpdates() {
                    guard let self, !Task.isCancelled, self.generation == generation else { return }
                    let previous = self.profileState
                    self.profileState = value
                    self.entitlement.update(value.entitlement, uid: feature.uid)
                    self.updateFeatureNetwork()
                    if !Set(value.pendingIDs).subtracting(previous?.pendingIDs ?? []).isEmpty {
                        self.requestSync()
                    }
                }
            } catch {
                guard let self, !Task.isCancelled, self.generation == generation else { return }
                self.message = "Your saved profile could not be read. Its data has been retained."
                self.requiresStorageRecovery = true
                self.diagnostics.accountFailure(error, at: .openStore)
            }
        }
        requestSync()
        return true
    }
    func connectivityChanged(_ connected: Bool) {
        guard self.connected != connected else { return }
        self.connected = connected
        updateFeatureNetwork()
        if connected { requestSync() } else { pauseSync() }
    }
    func setForeground(_ foreground: Bool) {
        guard self.foreground != foreground else { return }
        self.foreground = foreground
        updateFeatureNetwork()
        if foreground {
            start()
            requestSync()
        } else {
            pauseSync()
        }
    }
    private func pauseSync() {
        #if DEBUG
            tripPageTask?.cancel()
            tripPageTask = nil
            isLoadingMoreTrips = false
        #endif
        syncTask?.cancel()
        syncTask = nil
        retryTask?.cancel()
        retryTask = nil
        isSyncing = false
        syncRequested = false
        refreshRequested = false
        let previous = pausing
        let engine = engine
        let nativeProfile = nativeProfile
        pausing = Task {
            await previous?.value
            await nativeProfile?.sync.pause()
            await engine?.pause()
        }
    }
    #if DEBUG
        func loadMoreTrips() {
            guard !isLoadingMoreTrips, hasMoreTrips else { return }
            guard foreground, connected, let engine else {
                tripLibraryMessage =
                    "Connect to the internet to load more trips. Downloaded trips are still available."
                return
            }
            isLoadingMoreTrips = true
            tripLibraryMessage = nil
            let generation = generation
            tripPageTask = Task { [weak self] in
                do { try await engine.loadMoreTrips() } catch {
                    guard let self, !Task.isCancelled, self.generation == generation else { return }
                    self.tripLibraryMessage =
                        "More trips could not be loaded. Your downloaded trips are safe. Try again."
                }
                guard let self, !Task.isCancelled, self.generation == generation else { return }
                self.isLoadingMoreTrips = false
                self.tripPageTask = nil
            }
        }
    #endif
    func requestSync(refresh: Bool = false) {
        updateFeatureNetwork()
        nativeTrips?.requestSync(refresh: refresh)
        nativeVisits?.sync?.request(refresh: refresh)
        nativeExpeditions?.requestSync(refresh: refresh)
        if let nativeProfile {
            requestNativeProfileSync(nativeProfile, refresh: refresh)
            return
        }
        guard foreground, connected, identity != nil, let engine else { return }
        syncRequested = true
        refreshRequested = refreshRequested || refresh
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
                let refresh = self.refreshRequested
                self.refreshRequested = false
                if self.identity?.serverConfirmed != true {
                    do { try await self.auth?.reload() } catch { break }
                }
                guard !Task.isCancelled, self.generation == generation else { return }
                guard self.identity?.serverConfirmed == true else { break }
                let success = await engine.flush(refresh: refresh)
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
            if let delay { self.scheduleRetry(after: delay) }
        }
    }
    private func refreshNativeAccess() {
        if let nativeProfile { requestNativeProfileSync(nativeProfile, refresh: true) }
    }
    private func requestNativeProfileSync(_ feature: NativeProfileFeature, refresh: Bool = false) {
        guard foreground, connected, identity?.uid == feature.uid else { return }
        syncRequested = true
        refreshRequested = refreshRequested || refresh
        guard syncTask == nil else { return }
        retryTask?.cancel()
        retryTask = nil
        let generation = generation
        let pausing = pausing
        syncTask = Task { [weak self] in
            await pausing?.value
            guard let self, !Task.isCancelled, self.generation == generation else { return }
            self.isSyncing = true
            var retryAt: Date?
            repeat {
                self.syncRequested = false
                let refresh = self.refreshRequested
                self.refreshRequested = false
                do {
                    if self.identity?.serverConfirmed != true { try await self.auth?.reload() }
                    try Task.checkCancellation()
                    guard self.generation == generation, self.identity?.uid == feature.uid else { return }
                    guard self.identity?.serverConfirmed == true else { throw AccountFailure.accountChanged }
                    try await feature.sync.resume()
                    let result = try await feature.sync.synchronize(refresh: refresh)
                    try Task.checkCancellation()
                    guard self.generation == generation else { return }
                    self.message = nil
                    if case .retry(let date) = result {
                        retryAt = date
                        break
                    }
                } catch {
                    guard !Task.isCancelled, self.generation == generation else { return }
                    self.refreshRequested = self.refreshRequested || refresh
                    self.diagnostics.accountFailure(error, at: .readCloud)
                    if NativeProfileCloud.isTransient(error) {
                        self.message =
                            "Cloud sync is unavailable. Your saved profile and pending changes are safe on this iPhone."
                        retryAt = Date().addingTimeInterval(30)
                    } else {
                        self.message =
                            "Your profile could not be confirmed. Keep this app installed; saved changes are retained. Check your sign-in or app version before trying Sync now."
                    }
                    break
                }
            } while self.syncRequested
            guard !Task.isCancelled, self.generation == generation else { return }
            self.isSyncing = false
            self.syncTask = nil
            if let retryAt { self.scheduleRetry(after: .seconds(max(0, retryAt.timeIntervalSinceNow))) }
        }
    }
    private func scheduleRetry(after delay: Duration) {
        guard foreground, connected, identity != nil else { return }
        retryTask?.cancel()
        let generation = generation
        retryTask = Task { [weak self] in
            do { try await Task.sleep(for: delay) } catch { return }
            guard let self, self.generation == generation else { return }
            self.requestSync()
        }
    }
    func eraseDeletedAccount(uid: String) async throws {
        // A later account must never be closed or erased by an earlier deletion completion.
        guard identity?.uid == uid || identity == nil else { throw AccountFailure.accountChanged }
        activate(nil, force: true, openGuest: false)
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
        await nativeTrips?.waitForSync()
        await nativeVisits?.sync?.wait()
        await nativeExpeditions?.sync?.wait()
    }
    private func updateFeatureNetwork() {
        nativeTrips?.setNetworkAllowed(
            foreground && connected && identity?.serverConfirmed == true
                && profileState?.confirmed?.status == .active)
        nativeVisits?.sync?.setAllowed(
            foreground && connected && identity?.serverConfirmed == true
                && profileState?.confirmed?.status == .active)
        nativeExpeditions?.sync?.setAllowed(
            foreground && connected && identity?.serverConfirmed == true
                && profileState?.confirmed?.status == .active)
    }
    func stopAndWait() async {
        foreground = false
        authTask?.cancel()
        authTask = nil
        pauseSync()
        activate(nil, force: true, openGuest: false)
        await scopeTask?.value
        await pausing?.value
        scopeTask = nil
        pausing = nil
        scopeStarted = false
    }
}
