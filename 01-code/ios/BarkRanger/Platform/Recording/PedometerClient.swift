import CoreMotion
import Foundation

@MainActor protocol WalkMotionSource: AnyObject {
    var available: Bool { get }
    func start(from: Date) throws -> AsyncThrowingStream<Double, Error>
    func stop()
}

/// Optional system-estimated distance in meters. It is an alternative to GPS, never added to GPS distance.
@MainActor final class PedometerClient: WalkMotionSource {
    enum Failure: Error { case unavailable, denied }
    private let pedometer = CMPedometer()
    private var output: AsyncThrowingStream<Double, Error>.Continuation?
    private var generation = UUID()
    var available: Bool { CMPedometer.isDistanceAvailable() }
    func start(from date: Date) throws -> AsyncThrowingStream<Double, Error> {
        guard available else { throw Failure.unavailable }
        guard CMPedometer.authorizationStatus() != .denied, CMPedometer.authorizationStatus() != .restricted
        else {
            throw Failure.denied
        }
        stop()
        let id = UUID()
        generation = id
        let (stream, continuation) = AsyncThrowingStream<Double, Error>.makeStream(
            bufferingPolicy: .bufferingNewest(1))
        output = continuation
        pedometer.startUpdates(from: date) { data, error in
            let distance = data?.distance?.doubleValue
            Task { @MainActor [weak self] in
                guard let self, self.generation == id else { return }
                if error != nil {
                    self.output?.finish(throwing: Failure.unavailable)
                } else if let distance, distance.isFinite, distance >= 0 {
                    self.output?.yield(distance)
                }
            }
        }
        continuation.onTermination = { [weak self] _ in
            Task { @MainActor in if self?.generation == id { self?.stop() } }
        }
        return stream
    }
    func stop() {
        generation = UUID()
        pedometer.stopUpdates()
        output?.finish()
        output = nil
    }
}
