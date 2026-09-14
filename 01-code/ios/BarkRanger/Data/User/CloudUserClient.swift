import BarkDomain
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
import FirebaseFunctions
import Foundation

/// Server-only reads and callable writes. Firestore uses memory cache and never receives local writes.
actor CloudUserClient: CloudUserTransport {
    enum Failure: Error {
        case accountChanged, incomplete, invalidURL, changesUnavailable, membershipNotFound
    }
    #if DEBUG
        private(set) var documentReads = 0
        func tripListenerCount() async -> Int { await tripLibrary?.listenerCount ?? 0 }
    #endif
    private let allowsMutations: Bool
    private let allowsAccountManagement: Bool
    private let isTest: Bool
    private let auth: Auth
    private let db: Firestore
    private let functions: Functions
    private let eventClock = CloudUserEventClock()
    private var tripLibrary: CloudTripLibrary?
    private var tripScope: String?
    private var requestedActiveID: String?
    init(
        auth: Auth, db: Firestore, functions: Functions, isTest: Bool = false, allowsMutations: Bool,
        allowsAccountManagement: Bool
    ) {
        self.allowsMutations = allowsMutations
        self.allowsAccountManagement = allowsAccountManagement
        self.isTest = isTest
        self.auth = auth
        self.db = db
        self.functions = functions
    }
    private func check(_ uid: String) throws {
        try Task.checkCancellation()
        guard auth.currentUser?.uid == uid else { throw Failure.accountChanged }
    }
    func changes(uid: String, previous: PersonalSnapshot) async throws -> AsyncThrowingStream<
        CloudUserEvent, Error
    > {
        try check(uid)
        await tripLibrary?.stop()
        try check(uid)
        let library = CloudTripLibrary(db: db, uid: uid, clock: eventClock) { [weak self] in await self?.recordReads($0) }
        tripLibrary = library
        tripScope = uid
        await library.start(activeID: requestedActiveID)
        return await CloudUserObservation.changes(
            db: db, uid: uid, previous: previous, clock: eventClock, trips: library
        ) { [weak self] in await self?.recordReads($0) }
    }
    func selectActiveTrip(uid: String, id: String?) async throws {
        try check(uid)
        requestedActiveID = id
        if tripScope == uid { await tripLibrary?.selectActive(id) }
    }
    func loadMoreTrips(uid: String) async throws -> CloudUserEvent? {
        try check(uid)
        guard tripScope == uid, let tripLibrary else { throw Failure.incomplete }
        let event = try await tripLibrary.nextPage()
        try check(uid)
        return event
    }
    func acceptTripPage(uid: String, id: UUID) async throws {
        try check(uid)
        guard tripScope == uid else { throw Failure.accountChanged }
        await tripLibrary?.acceptPage(id)
    }
    func mutationReadBarrier(uid: String) throws -> UInt64? {
        try check(uid)
        return eventClock.next()
    }
    private func recordReads(_ count: Int) {
        #if DEBUG
            documentReads += count
        #endif
    }
    /// A receipt describes the accepted intent, not necessarily today's record (lost-response retry).
    /// Read only touched documents to reconcile it; listeners cover all unrelated account changes.
    func reconcile(uid: String, operations: [UserMutation]) async throws -> [CloudUserEvent] {
        var changes: [CloudUserEvent] = []
        if operations.contains(where: { $0.kind != .trip }) {
            try check(uid)
            let received = try await readDocument(db.collection("users").document(uid))
            let document = received.document
            try check(uid)
            recordReads(1)
            guard document.exists, !document.metadata.isFromCache,
                let fields = try CloudUserDecoder.value(document.data() ?? [:]).object
            else { throw Failure.incomplete }
            changes.append(
                CloudUserEvent(
                    change: .profile(UserProfile(fields: fields), confirmedAt: Date()),
                    revision: received.revision))
        }
        let ids = Set(operations.filter { $0.kind == .trip }.compactMap { $0.value.object?["id"]?.string })
        for id in ids.sorted() {
            try check(uid)
            let received = try await readDocument(
                db.collection("users").document(uid).collection("savedRoutes").document(id))
            let document = received.document
            try check(uid)
            recordReads(1)
            guard !document.metadata.isFromCache else { throw Failure.incomplete }
            if let data = document.data(), let fields = try CloudUserDecoder.value(data).object {
                changes.append(
                    CloudUserEvent(
                        change: .trips(upserts: [SavedRecord(id: id, fields: fields)], removed: []),
                        revision: received.revision))
            } else {
                changes.append(
                    CloudUserEvent(change: .trips(upserts: [], removed: [id]), revision: received.revision))
            }
        }
        return changes
    }
    // Immutable SDK snapshot + callback order; no SDK mutable state leaves the transport.
    private struct DocumentEvent: @unchecked Sendable {
        let document: DocumentSnapshot
        let revision: UInt64
    }
    private func readDocument(_ reference: DocumentReference) async throws -> DocumentEvent {
        let clock = eventClock
        return try await withCheckedThrowingContinuation { continuation in
            reference.getDocument(source: .server) { document, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let document {
                    continuation.resume(returning: DocumentEvent(document: document, revision: clock.next()))
                } else {
                    continuation.resume(throwing: Failure.incomplete)
                }
            }
        }
    }
    func submit(_ operation: UserMutation) async throws -> MutationReceipt {
        guard allowsMutations else { throw Failure.changesUnavailable }
        try check(operation.uid)
        let data = try JSONEncoder().encode(operation)
        let payload = try JSONSerialization.jsonObject(with: data)
        let result: HTTPSCallableResult
        let callable = functions.httpsCallable("applyUserMutation")
        callable.timeoutInterval = 15
        do { result = try await callable.call(payload) } catch {
            try check(operation.uid)
            switch MutationFailurePolicy.classify(error) {
            case .rejected(let reason): throw MutationSubmissionFailure(reason: reason)
            case .retry(let date):
                if let date { throw MutationRetryFailure(retryAt: date) }
            }
            throw error
        }
        try check(operation.uid)
        let receipt = try CloudUserDecoder.receipt(result.data)
        guard receipt.operation == operation else { throw Failure.incomplete }
        return receipt
    }
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL? {
        guard allowsAccountManagement else { throw Failure.changesUnavailable }
        try check(uid)
        let payload: [String: String] =
            action == .delete ? ["confirmation": "DELETE", "uid": uid] : ["uid": uid]
        let callable = functions.httpsCallable(action.rawValue)
        callable.timeoutInterval = 30
        let result = try await callable.call(payload)
        try check(uid)
        let fields = try CloudUserDecoder.value(result.data).object ?? [:]
        if action == .delete {
            guard fields["deleted"]?.bool == true else { throw Failure.incomplete }
        }
        if action == .restore, fields["restored"]?.bool != true {
            if isTest, fields["testProvider"]?.bool == true { return nil }
            throw Failure.membershipNotFound
        }
        guard action == .billing else { return nil }
        if isTest, fields["testProvider"]?.bool == true { return nil }
        guard let text = fields["url"]?.string, let url = URL(string: text), url.scheme == "https",
            let host = url.host, host == "lemonsqueezy.com" || host.hasSuffix(".lemonsqueezy.com"),
            url.user == nil, url.password == nil
        else { throw Failure.invalidURL }
        return url
    }
}
