import BarkDomain
import CoreLocation

@MainActor protocol WalkLocationSource: AnyObject {
    func startRecordingUpdates() async throws -> AsyncThrowingStream<WalkDistancePolicy.Sample, Error>
    func stopRecordingUpdates()
}

/// Shared location owner for bounded map/check-in fixes and an explicitly started background walk.
@MainActor
final class LocationClient: NSObject, CLLocationManagerDelegate, WalkLocationSource {
    enum Failure: Error { case denied, unavailable, timedOut, busy }
    private let manager: CLLocationManager?
    private var pending: CheckedContinuation<LocationFix, any Error>?
    private var timeout: Task<Void, Never>?
    private var requestID: UUID?
    private var recording: AsyncThrowingStream<WalkDistancePolicy.Sample, Error>.Continuation?
    private var recordingID: UUID?
    private var backgroundSession: CLBackgroundActivitySession?
    private var serviceSession: CLServiceSession?
    init(manager: CLLocationManager? = CLLocationManager()) {
        self.manager = manager
        super.init()
        manager?.delegate = self
        manager?.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }
    func authorization() -> CLAuthorizationStatus { manager?.authorizationStatus ?? .restricted }
    func currentFix(deadline: Duration = .seconds(15)) async throws -> Coordinate {
        try await observedFix(deadline: deadline).coordinate
    }
    func observedFix(deadline: Duration = .seconds(15)) async throws -> LocationFix {
        guard let manager else { throw Failure.unavailable }
        guard pending == nil else { throw Failure.busy }
        let id = UUID()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                requestID = id
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
            Task { @MainActor in
                guard self.requestID == id else { return }
                self.finish(.failure(CancellationError()))
            }
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if recording != nil,
            manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted
        {
            recording?.finish(throwing: Failure.denied)
            stopRecordingUpdates()
        }
        guard pending != nil else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        case .denied, .restricted: finish(.failure(Failure.denied))
        default: break
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let recording {
            for fix in locations {
                if let coordinate = Coordinate(
                    latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
                {
                    recording.yield(
                        WalkDistancePolicy.Sample(
                            coordinate: coordinate, accuracy: fix.horizontalAccuracy, date: fix.timestamp))
                }
            }
        }
        guard pending != nil else { return }
        guard let fix = locations.last, fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 5000,
            abs(fix.timestamp.timeIntervalSinceNow) < 60,
            let coordinate = Coordinate(
                latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude)
        else {
            finish(.failure(Failure.unavailable))
            return
        }
        finish(
            .success(
                LocationFix(coordinate: coordinate, accuracy: fix.horizontalAccuracy, date: fix.timestamp)))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        if (error as? CLError)?.code != .locationUnknown {
            recording?.finish(throwing: Failure.unavailable)
            stopRecordingUpdates()
        }
        finish(.failure(Failure.unavailable))
    }
    private func finish(_ result: Result<LocationFix, any Error>) {
        timeout?.cancel()
        timeout = nil
        if recording == nil { manager?.stopUpdatingLocation() }
        let continuation = pending
        pending = nil
        requestID = nil
        continuation?.resume(with: result)
    }
    func startRecordingUpdates() async throws -> AsyncThrowingStream<WalkDistancePolicy.Sample, Error> {
        guard let manager else { throw Failure.unavailable }
        guard recording == nil else { throw Failure.busy }
        let startID = UUID()
        recordingID = startID
        if manager.authorizationStatus == .notDetermined { _ = try await observedFix() }
        guard recordingID == startID else { throw CancellationError() }
        try Task.checkCancellation()
        guard [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) else {
            throw Failure.denied
        }
        let id = UUID()
        recordingID = id
        let (stream, output) = AsyncThrowingStream<WalkDistancePolicy.Sample, Error>.makeStream()
        recording = output
        serviceSession = CLServiceSession(authorization: .whenInUse)
        backgroundSession = CLBackgroundActivitySession()
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .fitness
        manager.distanceFilter = 3
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        output.onTermination = { [weak self] _ in
            Task { @MainActor in if self?.recordingID == id { self?.stopRecordingUpdates() } }
        }
        return stream
    }
    func stopRecordingUpdates() {
        recordingID = nil
        let output = recording
        recording = nil
        output?.finish()
        manager?.stopUpdatingLocation()
        manager?.allowsBackgroundLocationUpdates = false
        manager?.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager?.distanceFilter = kCLDistanceFilterNone
        backgroundSession?.invalidate()
        backgroundSession = nil
        serviceSession?.invalidate()
        serviceSession = nil
    }

}
