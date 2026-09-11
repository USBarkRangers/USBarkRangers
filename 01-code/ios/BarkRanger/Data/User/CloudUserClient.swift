import BarkDomain
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
import FirebaseFunctions
import Foundation

/// Server-only reads and callable writes. Firestore uses memory cache and never receives local writes.
actor CloudUserClient: CloudUserTransport {
    enum Failure: Error { case accountChanged, incomplete, invalidURL }
    private let isTest: Bool
    private let auth: Auth
    private let db: Firestore
    private let functions: Functions
    init(auth: Auth, db: Firestore, functions: Functions, isTest: Bool = false) {
        self.isTest = isTest
        self.auth = auth
        self.db = db
        self.functions = functions
    }
    private func check(_ uid: String) throws {
        try Task.checkCancellation()
        guard auth.currentUser?.uid == uid else { throw Failure.accountChanged }
    }
    func fetch(uid: String, previous: PersonalSnapshot) async throws -> PersonalSnapshot {
        try check(uid)
        let document = try await db.collection("users").document(uid).getDocument(source: .server)
        try check(uid)
        guard !document.metadata.isFromCache else { throw Failure.incomplete }
        guard
            document.exists
                || (previous.profile.fields.isEmpty && previous.trips.isEmpty
                    && previous.achievements.isEmpty)
        else { throw Failure.incomplete }
        let user = document.data() ?? [:]
        let achievements = try await records(uid: uid, collection: "achievements")
        let preliminary = try CloudUserDecoder.decode(
            uid: uid, user: user, trips: previous.trips, achievements: achievements)
        // Current rules allow saved-route reads only with Premium. Keep previously saved history when access expires.
        let trips =
            Entitlement(snapshot: preliminary).premium
            ? try await records(uid: uid, collection: "savedRoutes") : previous.trips
        try check(uid)
        return try CloudUserDecoder.decode(uid: uid, user: user, trips: trips, achievements: achievements)
    }
    private func records(uid: String, collection: String) async throws -> [SavedRecord] {
        var result: [SavedRecord] = []
        var cursor: DocumentSnapshot?
        while true {
            try check(uid)
            var query: Query = db.collection("users").document(uid).collection(collection)
                .order(by: FieldPath.documentID()).limit(to: 100)
            if let cursor { query = query.start(afterDocument: cursor) }
            let page = try await query.getDocuments(source: .server)
            try check(uid)
            guard !page.metadata.isFromCache else { throw Failure.incomplete }
            for document in page.documents {
                guard let fields = try CloudUserDecoder.value(document.data()).object else {
                    throw Failure.incomplete
                }
                result.append(SavedRecord(id: document.documentID, fields: fields))
            }
            if page.documents.count < 100 { return result }
            // Refuse incomplete acceptance instead of silently replacing a larger saved account with a prefix.
            guard result.count < 10_000 else { throw Failure.incomplete }
            cursor = page.documents.last
        }
    }
    func submit(_ operation: UserMutation) async throws -> MutationReceipt {
        try check(operation.uid)
        let data = try JSONEncoder().encode(operation)
        let payload = try JSONSerialization.jsonObject(with: data)
        let result: HTTPSCallableResult
        let callable = functions.httpsCallable("applyUserMutation")
        callable.timeoutInterval = 15
        do { result = try await callable.call(payload) } catch {
            try check(operation.uid)
            let code = (error as NSError).code
            if (error as NSError).domain == FunctionsErrorDomain,
                [FunctionsErrorCode.invalidArgument.rawValue, FunctionsErrorCode.alreadyExists.rawValue]
                    .contains(code)
            {
                throw MutationSubmissionFailure(reason: "server-rejected-change")
            }
            throw error
        }
        try check(operation.uid)
        let receipt = try CloudUserDecoder.receipt(result.data)
        guard receipt.operation == operation else { throw Failure.incomplete }
        return receipt
    }
    func accountAction(_ action: ExistingAccountAction, uid: String) async throws -> URL? {
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
        guard action == .billing else { return nil }
        if isTest, fields["testProvider"]?.bool == true { return nil }
        guard let text = fields["url"]?.string, let url = URL(string: text), url.scheme == "https",
            let host = url.host, host == "lemonsqueezy.com" || host.hasSuffix(".lemonsqueezy.com"),
            url.user == nil, url.password == nil
        else { throw Failure.invalidURL }
        return url
    }
}
