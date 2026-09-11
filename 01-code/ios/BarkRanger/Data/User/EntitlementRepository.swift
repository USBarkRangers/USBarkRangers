import BarkDomain
import Foundation
import Observation

/// One UID-bound publisher. Expiry updates access even when no new snapshot arrives.
@MainActor @Observable final class EntitlementRepository {
    private(set) var access: Entitlement?
    @ObservationIgnored private var expiry: Task<Void, Never>?
    func update(_ snapshot: PersonalSnapshot?) {
        let next = snapshot.map { Entitlement(snapshot: $0) }
        guard next != access else { return }
        expiry?.cancel()
        expiry = nil
        access = next
        guard let snapshot, let until = access?.validUntil, until > Date() else { return }
        expiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            self?.access = Entitlement(snapshot: snapshot)
            self?.expiry = nil
        }
    }
}
