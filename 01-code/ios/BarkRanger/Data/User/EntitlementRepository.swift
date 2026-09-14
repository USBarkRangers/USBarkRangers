import BarkDomain
import Foundation
import Observation

/// One UID-bound publisher. Expiry updates access even when no new snapshot arrives.
@MainActor @Observable final class EntitlementRepository {
    private(set) var access: Entitlement?
    @ObservationIgnored private var expiry: Task<Void, Never>?
    func update(_ native: NativeEntitlement?, uid: String) {
        let next = native.map { Entitlement(native: $0, uid: uid) }
        guard next != access else { return }
        expiry?.cancel()
        expiry = nil
        access = next
        guard let native, let until = next?.validUntil, next?.premium == true, until > Date() else { return }
        expiry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow))) } catch { return }
            guard !Task.isCancelled else { return }
            self?.access = Entitlement(native: native, uid: uid)
            self?.expiry = nil
        }
    }
    func clear() {
        expiry?.cancel()
        expiry = nil
        access = nil
    }
}
