import BarkDomain
import CoreLocation

/// A single, bounded locate request. No permission request at launch and no background tracking.
@MainActor
final class LocationClient: NSObject, CLLocationManagerDelegate {
    enum Failure: Error { case denied, unavailable, timedOut, busy }
    private let manager = CLLocationManager()
    private var pending: CheckedContinuation<Coordinate, any Error>?
    private var timeout: Task<Void, Never>?
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }
    func authorization() -> CLAuthorizationStatus { manager.authorizationStatus }
    func currentFix(deadline: Duration = .seconds(15)) async throws -> Coordinate {
        guard pending == nil else { throw Failure.busy }
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                timeout = Task {
                    try? await Task.sleep(for: deadline)
                    guard !Task.isCancelled else { return }
                    finish(.failure(Failure.timedOut))
                }
                switch manager.authorizationStatus {
                case .notDetermined: manager.requestWhenInUseAuthorization()
                case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
                default: finish(.failure(Failure.denied))
                }
            }
        } onCancel: {
            Task { @MainActor in self.finish(.failure(CancellationError())) }
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard pending != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        case .denied, .restricted: finish(.failure(Failure.denied))
        default: break
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last, fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 5000,
            abs(fix.timestamp.timeIntervalSinceNow) < 60,
            let coordinate = Coordinate(
                latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
        else {
            finish(.failure(Failure.unavailable))
            return
        }
        finish(.success(coordinate))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        finish(.failure(Failure.unavailable))
    }
    private func finish(_ result: Result<Coordinate, any Error>) {
        timeout?.cancel()
        timeout = nil
        manager.stopUpdatingLocation()
        let continuation = pending
        pending = nil
        continuation?.resume(with: result)
    }
}
