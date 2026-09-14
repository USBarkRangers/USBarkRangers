import BarkDomain
@preconcurrency import FirebaseFirestore
import Foundation

/// One bootstrap/event worker. Profile and awards stay live; trip reads have a bounded, owned lifetime.
nonisolated enum CloudUserObservation {
    private enum Input: @unchecked Sendable {
        case user(DocumentSnapshot, UInt64)
        case awards(QuerySnapshot, UInt64)
        case trip(CloudUserEvent)
    }

    @concurrent static func changes(
        db: Firestore, uid: String, previous: PersonalSnapshot, clock: CloudUserEventClock,
        trips: CloudTripLibrary, recordReads: @escaping @Sendable (Int) async -> Void
    ) async -> AsyncThrowingStream<CloudUserEvent, Error> {
        let (input, incoming) = AsyncThrowingStream<Input, Error>.makeStream()
        let user = db.collection("users").document(uid)
        let registrations = [
            user.addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                if let error { incoming.finish(throwing: error) }
                else if let snapshot, !snapshot.metadata.isFromCache {
                    incoming.yield(.user(snapshot, clock.next()))
                }
            },
            user.collection("achievements").order(by: FieldPath.documentID()).limit(to: 10_000)
                .addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                    if let error { incoming.finish(throwing: error) }
                    else if let snapshot, !snapshot.metadata.isFromCache {
                        incoming.yield(.awards(snapshot, clock.next()))
                    }
                },
        ]
        let forwarding = Task {
            do {
                for try await event in trips.events { incoming.yield(.trip(event)) }
                if !Task.isCancelled { incoming.finish(throwing: CloudUserClient.Failure.incomplete) }
            } catch { incoming.finish(throwing: error) }
        }
        let (output, outgoing) = AsyncThrowingStream<CloudUserEvent, Error>.makeStream()
        let deadline = Task {
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            incoming.finish(throwing: URLError(.timedOut))
        }
        let worker = Task {
            var snapshot = PersonalSnapshot(uid: uid)
            var library: TripLibraryState?
            var receivedUser = false, receivedAwards = false, initialized = false
            var failure: (any Error)?
            do {
                for try await input in input {
                    try Task.checkCancellation()
                    let event: CloudUserEvent
                    switch input {
                    case .user(let document, let revision):
                        guard document.exists || (previous.profile.fields.isEmpty && previous.trips.isEmpty
                            && previous.achievements.isEmpty && !receivedUser) else {
                            throw CloudUserClient.Failure.incomplete
                        }
                        guard let fields = try CloudUserDecoder.value(document.data() ?? [:]).object else {
                            throw CloudUserDecoder.Failure.malformed
                        }
                        if receivedUser && snapshot.profile.fields == fields { continue }
                        receivedUser = true
                        snapshot.profile = UserProfile(fields: fields)
                        await recordReads(1)
                        event = CloudUserEvent(change: .profile(snapshot.profile, confirmedAt: Date()), revision: revision)
                    case .awards(let documents, let revision):
                        guard documents.count < 10_000 else { throw CloudUserClient.Failure.incomplete }
                        let first = !receivedAwards
                        let values = first ? documents.documents : documents.documentChanges.filter { $0.type != .removed }.map(\.document)
                        let removed = Set(documents.documentChanges.filter { $0.type == .removed }.map { $0.document.documentID })
                        let records = try values.map(CloudUserDecoder.record)
                        receivedAwards = true
                        await recordReads(first ? max(1, documents.count) : records.count)
                        if !first && records.isEmpty && removed.isEmpty { continue }
                        event = CloudUserEvent(change: .achievements(upserts: records, removed: removed), revision: revision)
                    case .trip(let change): event = change
                    }
                    if !initialized {
                        snapshot = try event.change.applying(to: snapshot)
                        library = event.change.libraryState(after: library)
                        guard receivedUser, receivedAwards, let library else { continue }
                        outgoing.yield(CloudUserEvent(change: .bootstrap(snapshot, library), revision: event.revision))
                        initialized = true
                        deadline.cancel()
                    } else {
                        outgoing.yield(event)
                    }
                }
            } catch { failure = error }
            deadline.cancel()
            for registration in registrations { registration.remove() }
            forwarding.cancel()
            incoming.finish()
            await trips.stop()
            await forwarding.value
            outgoing.finish(throwing: failure)
        }
        outgoing.onTermination = { _ in worker.cancel() }
        return output
    }
}
