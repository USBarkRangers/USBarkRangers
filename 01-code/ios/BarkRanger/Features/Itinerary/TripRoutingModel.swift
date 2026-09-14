import BarkDomain
import Observation

/// One derived itinerary and road worker for both screens. Never edits or persists a trip.
@MainActor @Observable final class TripRoutingModel {
    let service: DayRouteService
    private(set) var plan: TripRoutePlan?
    private(set) var input: TripRouteInput?
    private var preferredDay: String?
    private var permitted = false
    private var planning: Task<Void, Never>?

    init(service: DayRouteService) { self.service = service }
    func update(_ draft: TripDraft?, permitted: Bool) {
        guard let draft else {
            clearTrip()
            return
        }
        preferredDay = draft.activeDayID
        if let preferredDay { service.prioritize(preferredDay) }
        let permissionChanged = self.permitted != permitted
        self.permitted = permitted
        if !permitted { service.suspend() }
        let next = TripRouteInput(draft.trip)
        guard input != next else {
            if permissionChanged, let plan { publish(plan) }
            return
        }
        input = next
        plan = nil
        planning?.cancel()
        planning = Task {
            let result = await Self.build(next)
            guard !Task.isCancelled, self.input == next else { return }
            plan = result
            publish(result)
            planning = nil
        }
    }
    private func publish(_ plan: TripRoutePlan) {
        guard let input else { return }
        // DayRouteService reuses coordinate-keyed legs. Presentation updates never discard that cache.
        service.update(tripID: input.tripID, plan: plan, preferredDay: preferredDay, permitted: permitted)
    }
    @concurrent private static func build(_ input: TripRouteInput) async -> TripRoutePlan { TripRoutePlan.build(input) }
    func stop() {
        permitted = false
        planning?.cancel()
        planning = nil
        if plan == nil { input = nil }
        service.suspend()
    }
    func reset(scope: String? = nil) {
        clearTrip()
        service.reset(scope: scope)
    }
    private func clearTrip() {
        stop()
        guard input != nil || service.tripID != nil else { return }
        input = nil
        plan = nil
        preferredDay = nil
        service.clearTrip()
    }
}
