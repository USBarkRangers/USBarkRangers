import BarkDomain
import Foundation
import Observation

/// App-owned session, not a screen model. Samples/checkpoints stay local; only finish stages an account intent.
@MainActor @Observable final class WalkRecorder {
    private(set) var recording: WalkRecording?
    private(set) var points: [RecordedPoint] = [] { didSet { pathRevision &+= 1 } }
    private(set) var pathRevision: UInt64 = 0
    private(set) var status = "Ready for a walk"
    private(set) var error: String?
    private(set) var busy = false
    let account: AccountSession
    let store: RecordingStore
    private let location: any WalkLocationSource
    private let motion: any WalkMotionSource
    private let now: () -> Date
    private let uptime: () -> TimeInterval
    private let activity: any WalkActivityDisplaying
    private var samples: Task<Void, Never>?
    private var clock: Task<Void, Never>?
    private var pendingPoints: [RecordedPoint] = []
    private var activeUptime: TimeInterval?
    private var persistedElapsed: Double = 0
    private var generation = UUID()
    private var lastCheckpoint = Date.distantPast
    private var writeTask: Task<Void, Never>?
    private var scopeTransition: Task<Void, Never>?
    var motionAvailable: Bool { motion.available }
    var canStart: Bool {
        account.dataAccess.canEditAccount && account.nativeExpeditions?.overview?.hasConfirmedSelection == true
            && account.nativeExpeditions?.overview?.selectionBlocked != true
            && recording == nil && !busy && scopeTransition == nil
    }
    init(
        account: AccountSession, store: RecordingStore, location: any WalkLocationSource,
        motion: any WalkMotionSource, activity: any WalkActivityDisplaying,
        now: @escaping () -> Date = Date.init,
        uptime: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
    ) {
        self.now = now
        self.uptime = uptime
        self.account = account
        self.store = store
        self.location = location
        self.motion = motion
        self.activity = activity
    }
    func activateAccount() async {
        let token = UUID()
        generation = token
        let previous = scopeTransition
        let transition = Task {
            await previous?.value
            guard generation == token else { return }
            await suspend()
            guard generation == token else { return }
            recording = nil
            points = []
            pendingPoints = []
            busy = false
            error = nil
            await activity.reconcile()
            guard let uid = account.identity?.uid, generation == token else { return }
            do {
                if var saved = try await store.recover(uid: uid) {
                    let recoveredPoints = try await store.points(uid: uid)
                    guard generation == token, account.identity?.uid == uid else { return }
                    if saved.phase != .finishing {
                        saved.phase = .recovered
                        saved.distance.reanchor()
                    }
                    recording = saved
                    points = Array(recoveredPoints.suffix(4_000))
                    status =
                        "Recovered saved progress. Recording was interrupted; missing distance was not invented."
                }
            } catch {
                if generation == token {
                    self.error = "The saved walk could not be opened. Its files have been kept for recovery."
                }
            }
        }
        scopeTransition = transition
        await transition.value
        if generation == token { scopeTransition = nil }
    }
    func start(source: WalkSummary.Source) async {
        guard canStart, source == .gps || source == .pedometer, let uid = account.identity?.uid else {
            return
        }
        let token = generation
        busy = true
        defer { if generation == token { busy = false } }
        error = nil
        guard let overview = account.nativeExpeditions?.overview, !overview.selectionBlocked else { return }
        let expedition = NativeExpeditionPresentation(overview: overview)
        let value = WalkRecording(
            uid: uid, source: source, runID: expedition.runID,
            trailName: expedition.trailID == nil ? "Your walk" : expedition.name, now: now())
        do {
            try await store.begin(value)
            guard token == generation, account.identity?.uid == uid else { return }
            recording = value
            points = []
            pendingPoints = []
            try await beginSource()
            if generation == token, let recording { await activity.start(recording) }
        } catch { if generation == token { await fail(error) } }
    }
    private func beginSource() async throws {
        guard let value = recording, account.identity?.uid == value.uid else {
            throw RecordingStore.Failure.wrongAccount
        }
        let token = generation
        if value.source == .gps {
            let updates = try await location.startRecordingUpdates()
            guard token == generation, recording?.id == value.id else {
                location.stopRecordingUpdates()
                return
            }
            samples = Task { [weak self] in
                do {
                    for try await sample in updates {
                        guard let self, !Task.isCancelled, self.generation == token else { return }
                        await self.consume(sample)
                    }
                } catch { if !Task.isCancelled { await self?.fail(error) } }
            }
        } else {
            let base = value.motionMeters
            let updates = try motion.start(from: now())
            samples = Task { [weak self] in
                do {
                    for try await meters in updates {
                        guard let self, !Task.isCancelled, self.generation == token,
                            self.recording?.phase == .recording, self.account.identity?.uid == value.uid
                        else { return }
                        self.recording?.motionMeters = base + meters
                        self.status = "System-estimated motion distance"
                        await self.checkpointIfNeeded()
                    }
                } catch { if !Task.isCancelled { await self?.fail(error) } }
            }
        }
        persistedElapsed = value.elapsedSeconds
        activeUptime = uptime()
        recording?.phase = .recording
        status = "Waiting for accurate distance…"
        clock = Task { [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard let self, self.generation == token else { return }
                self.updateElapsed()
                await self.checkpointIfNeeded()
            }
        }
    }
    /// Also exercised with synthetic input; no UI timer contributes to distance.
    func consume(_ sample: WalkDistancePolicy.Sample) async {
        guard var value = recording, value.phase == .recording, account.identity?.uid == value.uid else {
            return
        }
        guard sample.date >= value.startedAt else { return }
        let accepted = value.distance.accept(sample, now: now())
        recording = value
        if accepted == .anchor || accepted == .movement || accepted == .gap || accepted == .speed {
            let point = RecordedPoint(sample: sample, segment: value.distance.segment)
            points.append(point)
            pendingPoints.append(point)
            if points.count > 4_000 {
                points = points.enumerated().compactMap { $0.offset.isMultiple(of: 2) ? $0.element : nil }
            }
        }
        switch accepted {
        case .inaccurate: status = "Waiting for a more accurate location"
        case .gap, .speed: status = "GPS gap — distance resumes from this location"
        case .movement, .anchor, .stationary: status = "Recording your walk"
        case .stale: break
        }
        await checkpointIfNeeded()
    }
    private func updateElapsed() {
        guard let activeUptime else { return }
        recording?.elapsedSeconds = persistedElapsed + max(0, uptime() - activeUptime)
    }
    private func checkpointIfNeeded() async {
        guard now().timeIntervalSince(lastCheckpoint) >= 5 else { return }
        await checkpoint()
        if let recording { await activity.update(recording, force: false) }
    }
    private func checkpoint() async {
        if let writeTask {
            await writeTask.value
            return
        }
        guard var value = recording else { return }
        updateElapsed()
        value = recording ?? value
        value.checkpointAt = now()
        recording?.checkpointAt = value.checkpointAt
        let batch = pendingPoints
        pendingPoints.removeAll()
        lastCheckpoint = now()
        let task = Task {
            do {
                let saved = try await store.append(batch, checkpoint: value)
                if recording?.id == value.id { recording?.sampleBytes = saved.sampleBytes }
            } catch {
                if recording?.id == value.id {
                    pendingPoints.insert(contentsOf: batch, at: 0)
                    self.error =
                        "Your walk could not be saved. Recording is paused; retry saving before closing the app."
                    stopSource()
                    if recording?.phase != .finishing { recording?.phase = .paused }
                    await activity.end()
                }
            }
        }
        writeTask = task
        await task.value
        writeTask = nil
    }
    private func stopSource() {
        updateElapsed()
        activeUptime = nil
        samples?.cancel()
        samples = nil
        clock?.cancel()
        clock = nil
        location.stopRecordingUpdates()
        motion.stop()
    }
    func suspend() async {
        guard recording != nil else { return }
        stopSource()
        if recording?.phase != .finishing {
            recording?.phase = .paused
            recording?.distance.reanchor()
        }
        await writeTask?.value
        await checkpoint()
        await activity.end()
    }
    func pause() async {
        guard !busy else { return }
        let token = generation
        busy = true
        defer { if generation == token { busy = false } }
        await suspend()
        if generation == token { status = "Walk paused" }
    }
    func resume() async {
        guard !busy, let value = recording, value.phase != .recording, value.phase != .finishing,
            account.identity?.uid == value.uid, account.dataAccess.canEditAccount
        else { return }
        let token = generation
        busy = true
        defer { if generation == token { busy = false } }
        error = nil
        do {
            try await beginSource()
            if generation == token, let recording { await activity.start(recording) }
        } catch { if generation == token { await fail(error) } }
    }
    func finish() async {
        guard !busy, let value = recording, account.identity?.uid == value.uid else { return }
        let token = generation
        busy = true
        defer { if generation == token { busy = false } }
        error = nil
        stopSource()
        guard value.meters >= 0.05 * 1609.344 else {
            await suspend()
            if generation == token {
                error = "Record at least 0.05 miles before saving, or discard this walk."
            }
            return
        }
        if recording?.finishedAt == nil { recording?.finishedAt = now() }
        recording?.phase = .finishing
        await activity.end()
        guard generation == token else { return }
        await writeTask?.value
        await checkpoint()
        guard generation == token, error == nil, let summary = recording?.summary else { return }
        do {
            guard let repository = account.nativeExpeditions?.repository, account.identity?.uid == value.uid else {
                throw RecordingStore.Failure.wrongAccount
            }
            try await repository.commitWalk(summary, trailName: value.trailName)
            try await store.remove(uid: value.uid, id: value.id)
            guard recording?.id == value.id else { return }
            recording = nil
            points = []
            pendingPoints = []
            status = "Walk saved on this iPhone"
        } catch {
            if generation == token {
                self.error =
                    "Your recorded walk is kept safely. It could not be added to this account yet. Retry when editing is available; its original trail attribution is retained."
            }
        }
    }
    func discard() async {
        guard !busy, let value = recording else { return }
        let token = generation
        busy = true
        defer { if generation == token { busy = false } }
        await suspend()
        guard generation == token else { return }
        do {
            try await store.remove(uid: value.uid, id: value.id)
            recording = nil
            points = []
            pendingPoints = []
            error = nil
        } catch { self.error = "The saved walk could not be discarded. Please try again." }
    }
    private func fail(_ failure: any Error) async {
        await suspend()
        error =
            "Recording paused. Check location or motion permission, then resume. Your saved progress is retained."
    }
    func checkpointForBackground() async { await checkpoint() }
}
