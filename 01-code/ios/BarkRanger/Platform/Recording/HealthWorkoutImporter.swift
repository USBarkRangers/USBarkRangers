import BarkDomain
import Foundation
import HealthKit

/// Explicit read-only workout selection. No raw Health samples, automatic import, writing or background delivery.
@MainActor final class HealthWorkoutImporter {
    struct Candidate: Identifiable, Sendable {
        let id: String
        let startedAt: Date
        let endedAt: Date
        let meters: Double
        let seconds: Double
        func summary(runID: String?) -> WalkSummary {
            WalkSummary(
                id: id, source: .health, startedAt: startedAt, endedAt: endedAt,
                meters: meters, elapsedSeconds: seconds, runID: runID)
        }
    }
    enum Failure: Error { case unavailable }
    private let store = HKHealthStore()
    var available: Bool { HKHealthStore.isHealthDataAvailable() }
    func workouts() async throws -> [Candidate] {
        guard available else { throw Failure.unavailable }
        let workout = HKObjectType.workoutType()
        let distance = HKQuantityType(.distanceWalkingRunning)
        try await store.requestAuthorization(toShare: [], read: [workout, distance])
        try Task.checkCancellation()
        let dates = HKQuery.predicateForSamples(
            withStart: Date().addingTimeInterval(-90 * 86400), end: Date())
        let activities = NSCompoundPredicate(orPredicateWithSubpredicates: [
            HKQuery.predicateForWorkouts(with: .walking), HKQuery.predicateForWorkouts(with: .hiking),
        ])
        let query = HKSampleQueryDescriptor(
            predicates: [.workout(NSCompoundPredicate(andPredicateWithSubpredicates: [dates, activities]))],
            sortDescriptors: [SortDescriptor(\HKWorkout.endDate, order: .reverse)], limit: 100)
        let values = try await query.result(for: store)
        try Task.checkCancellation()
        return values.compactMap { workout in
            guard workout.sourceRevision.source.bundleIdentifier != Bundle.main.bundleIdentifier,
                workout.endDate <= Date(), let meters = workout.totalDistance?.doubleValue(for: .meter()),
                meters.isFinite, meters > 0
            else { return nil }
            return Candidate(
                id: workout.uuid.uuidString.lowercased(), startedAt: workout.startDate,
                endedAt: workout.endDate, meters: meters, seconds: workout.duration)
        }
    }
}
