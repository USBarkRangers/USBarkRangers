import BarkDomain
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
import Foundation

/// One exact owner-only summary read. No listeners, history scan, write, receipt,
/// or function admission. Auth changes are checked both sides of the suspension.
actor NativeProgressCloud {
    private let uid: String
    private let auth: Auth
    private let db: Firestore
    private var closed = false
    #if DEBUG
        private(set) var documentReadCount = 0
    #endif

    init(uid: String, auth: Auth, db: Firestore) throws {
        guard !uid.isEmpty, !uid.contains("/"), let project = auth.app?.options.projectID,
            ["bark-ranger-ios", "demo-bark-native"].contains(project), db.app.options.projectID == project
        else { throw NativeProfileCloud.Failure.wrongScope }
        self.uid = uid
        self.auth = auth
        self.db = db
    }

    func current() async throws -> NativeProgressSnapshot? {
        try check()
        #if DEBUG
            documentReadCount += 1
        #endif
        let document = try await db.collection("users").document(uid).collection("state")
            .document("progress").getDocument(source: .server)
        try check()
        guard !document.metadata.isFromCache else { throw NativeProfileCloud.Failure.incomplete }
        // The iOS SDK exposes no server read timestamp. A present summary can use
        // its exact commit stamp; absence needs the existing server proof, not Date().
        guard let data = document.data() else { return nil }
        guard let stamp = data["updatedAt"] as? Timestamp else {
            throw NativeProfileCloud.Failure.invalidReply
        }
        let bytes = try JSONSerialization.data(withJSONObject: [
            "version": 1,
            "progress": Self.wire(data), "readTime": Self.wire(stamp),
        ])
        let snapshot: NativeProgressSnapshot
        do {
            snapshot = try JSONDecoder().decode(NativeProgressSnapshot.self, from: bytes)
            try snapshot.validate()
        } catch {
            // The server's document has the wrong shape or breaks its own contract; this is
            // an invalid reply, never damaged local storage.
            throw NativeProfileCloud.Failure.invalidReply
        }
        return snapshot
    }

    // Keep Firestore's nanoseconds; passing through Date/milliseconds loses the
    // ordering evidence used by the durable native cache.
    private static func wire(_ value: Any) -> Any {
        if let stamp = value as? Timestamp {
            return ["seconds": stamp.seconds, "nanoseconds": Int64(stamp.nanoseconds)]
        }
        if let values = value as? [String: Any] { return values.mapValues(wire) }
        if let values = value as? [Any] { return values.map(wire) }
        return value
    }
    func close() { closed = true }
    private func check() throws {
        try Task.checkCancellation()
        guard !closed, auth.currentUser?.uid == uid else { throw NativeProfileCloud.Failure.accountChanged }
    }
}
