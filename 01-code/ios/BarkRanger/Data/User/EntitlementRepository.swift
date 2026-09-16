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
        guard let native, next?.premium == true else { return }
        // Paid expiry changes the label; the separate 40-day deadline changes editing.
        // One timer serves both transitions and is replaced on renewal/revocation.
        let paidThrough = native.validUntilMs.map { Date(timeIntervalSince1970: Double($0) / 1000) }
        guard let until = [paidThrough, next?.validUntil].compactMap({ $0 }).filter({ $0 > Date() }).min()
        else { return }
        expiry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow))) } catch { return }
            guard !Task.isCancelled else { return }
            self?.update(native, uid: uid)
        }
    }
    func clear() {
        expiry?.cancel()
        expiry = nil
        access = nil
    }
}
