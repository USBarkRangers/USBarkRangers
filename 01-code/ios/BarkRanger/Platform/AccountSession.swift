import BarkDomain
import Foundation
import Observation

/// One immutable set of owned resources. AccountSession remains the lifecycle owner.
@MainActor struct AccountScope {
    /// Lifecycle operations travel with each feature at its opening site. Adding a
    /// feature cannot silently omit it from close, sync, wait, or network propagation.
    struct Feature {
        let stage: ScopeOpenFailure.Stage
        let value: Any
        let close: () async -> Void
        var request: (Bool) -> Void = { _ in }
        var wait: () async -> Void = {}
        var setNetworkAllowed: (Bool) -> Void = { _ in }
    }
    let features: [Feature]
    let scheduler: NativeFeatureSync?
    let observation: Task<Void, Never>?
    let guestStore: NativeStore?
    init(
        features: [Feature] = [], scheduler: NativeFeatureSync? = nil,
        observation: Task<Void, Never>? = nil, guestStore: NativeStore? = nil
    ) {
        self.features = features
        self.scheduler = scheduler
        self.observation = observation
        self.guestStore = guestStore
    }
    func feature<F>(_ type: F.Type = F.self) -> F? {
        features.lazy.compactMap { $0.value as? F }.first
    }
    var profile: NativeProfileFeature? { feature() }
    var savedPins: NativeSavedPinFeature? { feature() }
    var trips: NativeTripFeature? { feature() }
    var visits: NativeVisitFeature? { feature() }
    var expeditions: NativeExpeditionFeature? { feature() }
    var leaderboard: NativeLeaderboardRepository? { feature() }
    private var accountFeatures: [Feature] {
        features.filter { $0.stage != .profile && $0.stage != .savedPins }
    }
    private var syncingFeatures: [Feature] {
        accountFeatures + features.filter { $0.stage == .savedPins }
    }
    func close(afterObservation drain: Task<Void, Never>? = nil, record: ((String) -> Void)? = nil) async {
        await scheduler?.close()
        #if DEBUG
            if scheduler != nil { record?("scheduler") }
        #endif
        await observation?.value
        #if DEBUG
            if observation != nil { record?("observation") }
        #endif
        await drain?.value
        #if DEBUG
            if drain != nil { record?("editor") }
        #endif
        // Registration order is trips, visits, expeditions, leaderboard. Saved pins,
        // the guest writer, and the profile writer deliberately close afterward.
        for feature in accountFeatures {
            await feature.close()
            #if DEBUG
                record?(feature.stage.rawValue)
            #endif
        }
        for feature in features where feature.stage == .savedPins {
            await feature.close()
            #if DEBUG
                record?("savedPins")
            #endif
        }
        await guestStore?.close()
        #if DEBUG
            if guestStore != nil { record?("guestStore") }
        #endif
        for feature in features where feature.stage == .profile {
            await feature.close()
            #if DEBUG
                record?("profile")
            #endif
        }
    }
    func requestSync(refresh: Bool) {
        for feature in syncingFeatures { feature.request(refresh) }
        scheduler?.request(refresh: refresh)
    }
    func waitForSync() async {
        await scheduler?.wait()
        for feature in syncingFeatures { await feature.wait() }
    }
    func setNetworkAllowed(_ allowed: Bool) {
        for feature in syncingFeatures { feature.setNetworkAllowed(allowed) }
    }
}

struct ScopeOpenFailure: Error {
    // Guest storage keeps the existing general-storage recovery behavior.
    enum Stage: String { case profile, savedPins, trips, visits, expeditions, leaderboard, guest }
    let stage: Stage
    let underlying: any Error
}

/// One active account lifetime. UID changes clear presentation before any asynchronous close/open work.
@MainActor @Observable final class AccountSession {
    #if DEBUG
        // Test-only lifecycle events contain resource names, never account data.
        @ObservationIgnored var lifecycleObserver: ((String) -> Void)?
        @ObservationIgnored var beforeFeatureStart: ((String, NativeStore) async throws -> Void)?
        var scopeStartedForTesting: Bool { scopeStarted }
    #endif
    private(set) var identity: AccountIdentity?
    private var scope = AccountScope()
    var nativeProfile: NativeProfileFeature? { scope.profile }
    var nativeTrips: NativeTripFeature? { scope.trips }
    var nativeVisits: NativeVisitFeature? { scope.visits }
    var nativeExpeditions: NativeExpeditionFeature? { scope.expeditions }
    var nativeLeaderboard: NativeLeaderboardRepository? { scope.leaderboard }
    var nativeSavedPins: NativeSavedPinFeature? { scope.savedPins }
    /// Typed access for additional registered features; existing named projections remain compatible.
    func feature<F>(_ type: F.Type) -> F? { scope.feature(type) }
    // Installed once by the shared editor. Capture/drain its old-scope checkpoint
    // before closing that writer; identity still clears synchronously below.
    var closeTripEditing: (() -> Task<Void, Never>)?
    var prepareTripIdentityChange: (() async throws -> Void)?
    var tripScope: String? { nativeTrips?.scope }
    private(set) var profileState: NativeStore.ProfileView?
    let nativeProfileConfiguration: NativeProfileConfiguration?
    private var sessionMessage: String?
    var message: String? { sessionMessage ?? scope.scheduler?.message }
    var isSyncing: Bool { scope.scheduler?.running == true }
    private(set) var tripLibraryMessage: String?
    private(set) var requiresStorageRecovery = false
    let entitlement = EntitlementRepository()
    var dataAccess: AccountDataAccess {
        AccountDataAccess(entitlement: entitlement.access, isGuest: identity == nil && nativeTrips != nil)
    }
    let auth: (any AccountAuthenticating)?
    let capabilities: AccountCapabilities
    private let diagnostics: Diagnostics
    let directory: URL
    private var authTask: Task<Void, Never>?
    private var scopeTask: Task<Void, Never>?
    private var generation = UUID()
    private var foreground = false
    private var connected = false
    private var scopeStarted = false
    var eraseAdditionalAccountData: ((String) async throws -> Void)?
    private var deletionTask: Task<Void, Error>?
    private(set) var deletionMessage: String?
    enum CleanupState { case ready, checking, failed }
    private(set) var cleanupState: CleanupState = .ready
    init(
        auth: (any AccountAuthenticating)?, directory: URL,
        capabilities: AccountCapabilities = .init(), diagnostics: Diagnostics = Diagnostics(),
        nativeProfileConfiguration: NativeProfileConfiguration? = nil
    ) {
        self.capabilities = capabilities
        self.diagnostics = diagnostics
        self.auth = auth
        self.directory = directory
        self.nativeProfileConfiguration = nativeProfileConfiguration
    }
    func start() {
        guard authTask == nil else { return }
        guard let auth else {
            if !scopeStarted { activate(nil) }
            return
        }
        let retryingCleanup = cleanupState == .failed
        cleanupState = .checking
        authTask = Task { [weak self] in
            do {
                let removed = try await self?.resumeAccountRemoval() == true
                try Task.checkCancellation()
                if removed {
                    self?.deletionMessage =
                        "Device cleanup finished. Your account deletion was already requested."
                } else if retryingCleanup {
                    self?.deletionMessage = nil
                }
                self?.cleanupState = .ready
            } catch {
                guard !Task.isCancelled else { return }
                self?.diagnostics.accountFailure(error, at: .removeAccountData)
                self?.deletionMessage =
                    "Device cleanup could not finish. Retry cleanup before signing in. Keep the app installed to preserve your other saved data."
                self?.cleanupState = .failed
                // A failed task is finished, not an active auth listener. Allow a
                // deliberate retry (or next foreground) to reopen this same lifecycle.
                self?.authTask = nil
                return
            }
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
        let tripEditingDrain = closeTripEditing?()
        let outgoing = scope
        outgoing.observation?.cancel()
        scope = AccountScope()
        profileState = nil
        let previousTask = scopeTask
        scopeTask?.cancel()
        tripLibraryMessage = nil
        identity = next
        entitlement.clear()
        sessionMessage = nil
        requiresStorageRecovery = false
        #if DEBUG
            let observeLifecycle = lifecycleObserver
        #else
            let observeLifecycle: ((String) -> Void)? = nil
        #endif
        scopeTask = Task { [weak self] in
            await previousTask?.value
            #if DEBUG
                if previousTask != nil { observeLifecycle?("previousTask") }
            #endif
            await outgoing.close(afterObservation: tripEditingDrain, record: observeLifecycle)
            guard let self, self.isCurrent(generation), next != nil || openGuest else { return }
            await self.openScope(next, generation: generation)
        }
    }
    private func owns(_ generation: UUID) -> Bool { self.generation == generation }
    private func isCurrent(_ generation: UUID) -> Bool { !Task.isCancelled && owns(generation) }

    /// Start a feature or close it. nil means this activation was superseded.
    private func opened<F>(
        _ feature: F, generation: UUID, start: () async throws -> Void, close: () async -> Void
    ) async throws -> F? {
        do { try await start() } catch {
            await close()
            throw error
        }
        guard isCurrent(generation) else {
            await close()
            return nil
        }
        return feature
    }
    private func atStage<T>(
        _ stage: ScopeOpenFailure.Stage, _ work: () async throws -> T
    ) async throws -> T {
        do { return try await work() } catch { throw ScopeOpenFailure(stage: stage, underlying: error) }
    }
    private func registered<F>(
        _ feature: F, stage: ScopeOpenFailure.Stage, store: NativeStore, generation: UUID,
        start: () async throws -> Void = {}, close: @escaping () async -> Void,
        request: @escaping (Bool) -> Void = { _ in }, wait: @escaping () async -> Void = {},
        network: @escaping (Bool) -> Void = { _ in }
    ) async throws -> AccountScope.Feature? {
        guard
            let feature = try await opened(
                feature, generation: generation,
                start: {
                    #if DEBUG
                        try await self.beforeFeatureStart?(stage.rawValue, store)
                    #endif
                    try await start()
                }, close: close)
        else { return nil }
        return AccountScope.Feature(
            stage: stage, value: feature, close: close, request: request, wait: wait,
            setNetworkAllowed: network)
    }
    private func openScope(_ next: AccountIdentity?, generation: UUID) async {
        var features: [AccountScope.Feature] = []
        var guestStore: NativeStore?
        do {
            let store: NativeStore
            let project = nativeProfileConfiguration?.project ?? "bark-ranger-ios"
            if let next {
                guard let base = try await openNativeProfile(next, generation: generation),
                    let profile = base.profile
                else { return }
                features = base.features
                store = profile.store
            } else {
                store = try await atStage(.guest) {
                    try await NativeStore.open(
                        directory: self.directory, project: project, uid: "guest-drafts", guest: true)
                }
                guestStore = store
            }
            for (stage, open) in featureOpeners(store: store, identity: next, generation: generation) {
                guard let feature = try await atStage(stage, open) else {
                    await AccountScope(features: features, guestStore: guestStore).close()
                    return
                }
                features.append(feature)
            }
            guard isCurrent(generation) else {
                await AccountScope(features: features, guestStore: guestStore).close()
                return
            }
            publish(AccountScope(features: features, guestStore: guestStore), generation: generation)
        } catch {
            guard isCurrent(generation) else {
                await AccountScope(features: features, guestStore: guestStore).close()
                return
            }
            // A guest trip failure owns its writer. Account feature failures retain the
            // healthy earlier features, exactly as before; saved-pin failure retains none.
            if let guestStore { await guestStore.close() }
            guard isCurrent(generation) else {
                await AccountScope(features: features).close()
                return
            }
            publish(AccountScope(features: features), generation: generation)
            reportOpenFailure(error as? ScopeOpenFailure ?? .init(stage: .profile, underlying: error))
        }
    }
    /// Each feature's opening and all four lifecycle operations are registered together.
    private func featureOpeners(
        store: NativeStore, identity: AccountIdentity?, generation: UUID
    ) -> [(ScopeOpenFailure.Stage, () async throws -> AccountScope.Feature?)] {
        let configuration = nativeProfileConfiguration
        let project = configuration?.project ?? "bark-ranger-ios"
        var openers: [(ScopeOpenFailure.Stage, () async throws -> AccountScope.Feature?)] = [
            (
                identity == nil ? .guest : .trips,
                {
                    let feature = NativeTripFeature(
                        scope: project + ":" + (identity?.uid ?? "guest-drafts"), store: store,
                        cloud: try identity.flatMap { try configuration?.connectTrips?($0.uid) })
                    return try await self.registered(
                        feature, stage: .trips, store: store, generation: generation,
                        start: {
                            if let identity {
                                try await NativeDraftHandoff.adopt(
                                    directory: self.directory, project: project, uid: identity.uid,
                                    into: store)
                            }
                            try await feature.start()
                        }, close: { await feature.close() },
                        request: { feature.requestSync(refresh: $0) }, wait: { await feature.waitForSync() },
                        network: { feature.setNetworkAllowed($0) })
                }
            )
        ]
        if let identity, let configuration {
            openers += [
                (
                    .visits,
                    {
                        let feature = NativeVisitFeature(
                            scope: project + ":" + identity.uid, store: store,
                            cloud: try configuration.connectVisits?(identity.uid),
                            refreshAccess: { [weak self] in self?.refreshNativeAccess() })
                        return try await self.registered(
                            feature, stage: .visits, store: store, generation: generation,
                            start: { try await feature.start() }, close: { await feature.close() },
                            request: { feature.sync?.request(refresh: $0) },
                            wait: { await feature.sync?.wait() },
                            network: { feature.sync?.setAllowed($0) })
                    }
                ),
                (
                    .expeditions,
                    {
                        let feature = NativeExpeditionFeature(
                            scope: project + ":" + identity.uid, store: store,
                            cloud: try configuration.connectExpeditions?(identity.uid),
                            refreshAccess: { [weak self] in self?.refreshNativeAccess() })
                        return try await self.registered(
                            feature, stage: .expeditions, store: store, generation: generation,
                            start: { try await feature.start() }, close: { await feature.close() },
                            request: { feature.sync?.request(refresh: $0) },
                            wait: { await feature.sync?.wait() },
                            network: { feature.sync?.setAllowed($0) })
                    }
                ),
            ]
            if let connect = configuration.connectLeaderboard {
                openers.append(
                    (
                        .leaderboard,
                        {
                            let feature = try connect(identity.uid)
                            return try await self.registered(
                                feature, stage: .leaderboard, store: store, generation: generation,
                                close: { await feature.close() })
                        }
                    ))
            }
        }
        return openers
    }
    /// Profile and saved pins are admitted together; failure cannot strand an unobserved writer.
    private func openNativeProfile(_ identity: AccountIdentity, generation: UUID) async throws
        -> AccountScope?
    {
        let feature = try await atStage(.profile) {
            guard let configuration = self.nativeProfileConfiguration else {
                throw NativeStore.Failure.unavailable
            }
            return try await NativeProfileFeature.open(
                configuration: configuration, directory: self.directory, uid: identity.uid)
        }
        guard isCurrent(generation) else {
            await feature.close()
            return nil
        }
        do {
            let pins = try await atStage(.savedPins) {
                let pins = NativeSavedPinFeature(
                    store: feature.store,
                    cloud: try self.nativeProfileConfiguration?.connectSavedPins?(identity.uid))
                return try await self.registered(
                    pins, stage: .savedPins, store: feature.store, generation: generation,
                    start: { try await pins.start() }, close: { await pins.close() },
                    request: { pins.sync?.request(refresh: $0) }, wait: { await pins.sync?.wait() },
                    network: { pins.sync?.setAllowed($0) })
            }
            guard let pins else {
                await feature.close()
                return nil
            }
            return AccountScope(features: [
                .init(stage: .profile, value: feature, close: { await feature.close() }), pins,
            ])
        } catch {
            await feature.close()
            throw error
        }
    }
    private func publish(_ incoming: AccountScope, generation: UUID) {
        guard let feature = incoming.profile else {
            scope = incoming
            updateFeatureNetwork()
            return
        }
        let scheduler = NativeFeatureSync(
            label: "Profile",
            work: { [weak self] refresh in
                guard let self, self.owns(generation) else { throw CancellationError() }
                if self.identity?.serverConfirmed != true { try await self.auth?.reload() }
                try Task.checkCancellation()
                guard self.owns(generation), self.identity?.uid == feature.uid,
                    self.identity?.serverConfirmed == true
                else { throw AccountFailure.accountChanged }
                try await feature.sync.resume()
                let result = try await feature.sync.synchronize(refresh: refresh)
                try Task.checkCancellation()
                guard self.owns(generation) else { throw CancellationError() }
                self.sessionMessage = nil
                if case .retry(let date) = result { return date }
                return nil
            }, pause: { await feature.sync.pause() })
        let observation = Task { [weak self] in
            do {
                for await value in try await feature.store.profileUpdates() {
                    guard let self, !Task.isCancelled, self.owns(generation) else { return }
                    let previous = self.profileState
                    self.profileState = value
                    self.entitlement.update(value.entitlement, uid: feature.uid)
                    self.updateFeatureNetwork()
                    if value.entitlement != previous?.entitlement
                        || !Set(value.pendingIDs).subtracting(previous?.pendingIDs ?? []).isEmpty
                    {
                        self.requestSync()
                    }
                }
            } catch {
                guard let self, !Task.isCancelled, self.owns(generation) else { return }
                self.sessionMessage = "Your saved profile could not be read. Its data has been retained."
                self.requiresStorageRecovery = true
                self.diagnostics.accountFailure(error, at: .openStore)
            }
        }
        scope = AccountScope(
            features: incoming.features, scheduler: scheduler, observation: observation,
            guestStore: incoming.guestStore)
        requestSync()
    }
    private func reportOpenFailure(_ failure: ScopeOpenFailure) {
        let error = failure.underlying
        diagnostics.accountFailure(error, at: .openStore)
        switch failure.stage {
        case .trips:
            tripLibraryMessage =
                "Trip storage could not be opened. Your saved files are retained; keep the app installed and retry."
        case .profile, .guest, .savedPins:
            requiresStorageRecovery = error is DecodingError || (error as? NativeStore.Failure) == .corrupt
            if failure.stage == .savedPins {
                sessionMessage =
                    "Saved pins could not be opened. Your saved files are retained; keep the app installed and retry."
            } else {
                sessionMessage =
                    requiresStorageRecovery
                    ? "Your saved account needs a compatible app update or recovery. Keep this app installed; your saved files have not been replaced."
                    : "Your saved account data could not be opened. It has been kept for recovery."
            }
        default:
            tripLibraryMessage =
                "Visit or walk storage could not be opened. Your files are retained; your profile and trips are available."
        }
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
    private func pauseSync() { scope.scheduler?.setAllowed(false) }
    func requestSync(refresh: Bool = false) {
        updateFeatureNetwork()
        scope.requestSync(refresh: refresh)
    }
    private func refreshNativeAccess() { scope.scheduler?.request(refresh: true) }
    func retryStorage() { activate(identity, force: true) }
    func waitForSync() async {
        requestSync()
        await scope.waitForSync()
    }
    private var featureNetworkAllowed: Bool {
        foreground && connected && identity?.serverConfirmed == true
            && profileState?.confirmed?.status == .active
    }
    private func updateFeatureNetwork() {
        scope.scheduler?.setAllowed(foreground && connected && identity != nil)
        scope.setNetworkAllowed(featureNetworkAllowed)
    }
    func stopAndWait(preservingForeground: Bool = false) async {
        if !preservingForeground { foreground = false }
        let closingAuth = authTask
        closingAuth?.cancel()
        authTask = nil
        pauseSync()
        activate(nil, force: true, openGuest: false)
        await closingAuth?.value
        await scopeTask?.value
        scopeTask = nil
        scopeStarted = false
    }

    func deleteAccount() async throws {
        guard capabilities.accountManagement, let uid = identity?.uid,
            let configuration = nativeProfileConfiguration, let remove = configuration.deleteAccount,
            let auth
        else { throw NativeStore.Failure.unavailable }
        let store = nativeProfile?.store
        if let deletionTask { return try await deletionTask.value }
        // The lifecycle owns completion; dismissing the form cannot cancel accepted cleanup.
        let task = Task { @MainActor in
            try await remove(uid)
            let request = NativeAccountRemovalFiles.Request(project: configuration.project, uid: uid)
            try NativeAccountRemovalFiles.retain(request, directory: directory)
            guard identity?.uid == uid else { throw AccountFailure.accountChanged }
            cleanupState = .checking
            // Deletion closes an account, not the app. The next sign-in must still
            // sync while this scene is foreground (and respect a concurrent background).
            await stopAndWait(preservingForeground: true)
            do {
                try auth.signOut()
                try await store?.eraseClosedAccount()
                try await resumeAccountRemoval()
                deletionMessage =
                    "Account deletion requested. Device data removed; cloud cleanup continues automatically."
            } catch {
                deletionMessage =
                    "Account deletion is queued. Device cleanup will retry when you reopen the app."
                start()
                throw error
            }
            start()
        }
        deletionTask = task
        defer { deletionTask = nil }
        try await task.value
    }

    @discardableResult private func resumeAccountRemoval() async throws -> Bool {
        let requests = try NativeAccountRemovalFiles.pending(directory: directory)
        for request in requests {
            try Task.checkCancellation()
            guard request.project == nativeProfileConfiguration?.project else {
                throw NativeStore.Failure.wrongScope
            }
            try nativeProfileConfiguration?.forgetDeletedIdentity?(request.uid)
            try await eraseAdditionalAccountData?(request.uid)
            try Task.checkCancellation()
            try NativeAccountRemovalFiles.eraseClosedAccount(request, directory: directory)
            try NativeAccountRemovalFiles.finish(request, directory: directory)
        }
        return !requests.isEmpty
    }
}
