import BarkDomain
import Foundation

/// Current UI values only. Confirmed mileage and pending status are intentionally
/// distinct, including when another device has already advanced server totals.
nonisolated struct NativeExpeditionPresentation {
    let overview: NativeStore.ExpeditionOverview?
    var runID: String? { overview?.runID }
    var trailID: String? { overview?.pendingTrailID ?? overview?.activeRun?.trailID }
    private var pendingTrail: Trail? { (try? Trail.bundled())?.first { $0.id == overview?.pendingTrailID } }
    var name: String { pendingTrail?.name ?? overview?.activeRun?.name ?? (overview?.hasConfirmedSelection == true ? "Choose your next trail" : "Expedition not downloaded yet") }
    var meters: Double { overview?.activeRun?.meters ?? 0 }
    var totalMeters: Double { pendingTrail?.meters ?? overview?.activeRun?.totalMeters ?? 0 }
    var fraction: Double { totalMeters > 0 ? min(1, max(0, meters / totalMeters)) : 0 }
    var lifetimeMeters: Double { overview?.state?.lifetimeMeters ?? 0 }
}
