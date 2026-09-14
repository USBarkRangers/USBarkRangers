import BarkDomain
import MapKit
import SwiftUI
import Testing

@testable import BarkRanger

@MainActor struct MapTripEditingTests {
    private func park(_ name: String, category: ParkCategory = .national, aliases: [ParkID] = []) throws
        -> Park
    {
        Park(
            id: .init(rawValue: name), siteID: .init(rawValue: name), name: name,
            coordinate: try #require(Coordinate(latitude: 44, longitude: -68)), category: category,
            aliases: aliases)
    }
    @Test func tripParksAreAdditiveToFiltersAndSearchKeepsItsRankAndExactCount() async throws {
        let context = try DiscoveryTestContext()
        defer { context.close() }
        try await context.start()
        let catalog = try #require(context.model.catalogState.snapshot)
        let statePark = try #require(catalog.parks.first { $0.category == .state })
        var query = ParkFilter.Query()
        query.categories = [.national]
        let ordinary = try await ParkResults.compute(snapshot: catalog, index: nil, query: query)
        let withTrip = try await ParkResults.compute(
            snapshot: catalog, index: nil, query: query,
            personal: .init(trip: [statePark.id]))
        #expect(withTrip.matchingIDs == ordinary.matchingIDs.union([statePark.id]))
        #expect(withTrip.result.matchingCount == withTrip.parks.count)
        query.search = try #require(ordinary.parks.first).name
        let searched = try await ParkResults.compute(
            snapshot: catalog, index: nil, query: query,
            personal: .init(trip: [statePark.id]))
        #expect(searched.parks.first?.name == query.search)
        #expect(searched.matchingIDs.contains(statePark.id))
        let hidden = try await ParkResults.compute(snapshot: catalog, index: nil, query: query)
        #expect(!hidden.matchingIDs.contains(statePark.id))
    }
    @Test func heldDragCanChangeDaysAndDropAtomicallyWithoutLosingStopFields() async throws {
        var a = Trip.Stop(park: try park("A"))
        a.notes = "Water"
        a.arrivalTime = "09:30"
        let b = Trip.Stop(park: try park("B"))
        let c = Trip.Stop(park: try park("C"))
        let trip = Trip(
            id: "trip",
            days: [
                .init(id: "one", stops: [a, b], notes: "First day"),
                .init(id: "two", stops: [c], notes: "Second day"),
                .init(id: "three", notes: "Empty destination"),
            ])
        let drag = RouteStopDragCoordinator()
        func destination(_ index: Int) -> RouteStopDragCoordinator.Destination {
            .init(
                scope: "user", target: .init(tripID: trip.id, dayID: trip.days[index].id),
                stops: trip.days[index].stops, enabled: true)
        }
        drag.destination = destination(0)
        #expect(drag.begin(at: 0) != nil)
        let source = try #require(drag.source)
        drag.destination = destination(2)
        drag.destination = destination(1)  // The back arrow changes destination, never the captured source.
        let change = try #require(drag.change(for: source, at: 0))
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = try await LocalStore.open(directory: directory, uid: "user")
        try await store.seedPremium()
        let repository = TripRepository(store: store)
        try await repository.saveDraft(.init(trip: trip))
        try await repository.editDay(.init(tripID: trip.id, dayID: "two"), edit: change)
        let result = try #require(try await store.readSnapshot().drafts?.first?.trip)
        #expect(result.days[0].stops == [b])
        #expect(result.days[1].stops == [a, c])
        #expect(result.days.map(\.notes) == trip.days.map(\.notes))
        #expect(result.days[2] == trip.days[2])
        #expect(try await store.readSnapshot().pending.isEmpty)
        await store.close()
        let reopened = try await LocalStore.open(directory: directory, uid: "user")
        #expect(try await reopened.readSnapshot().drafts?.first?.trip == result)
        await reopened.close()
        try FileManager.default.removeItem(at: directory)
    }
    @Test func dragCancellationScopeChangesStaleOrdersAndEmptyDaysAreHandled() throws {
        let a = Trip.Stop(park: try park("A"))
        let b = Trip.Stop(park: try park("B"))
        let trip = Trip(id: "trip", days: [.init(id: "one", stops: [a, b]), .init(id: "empty")])
        let drag = RouteStopDragCoordinator()
        drag.destination = .init(
            scope: "A", target: .init(tripID: trip.id, dayID: "one"), stops: [a, b], enabled: true)
        _ = drag.begin(at: 0)
        let source = try #require(drag.source)
        let reorder = try #require(drag.change(for: source, at: 1))
        #expect(try reorder.applying(to: trip, dayID: "one").days[0].stops == [b, a])
        drag.destination = .init(
            scope: "A", target: .init(tripID: trip.id, dayID: "empty"), stops: [], enabled: true)
        let move = try #require(drag.change(for: source, at: 0))
        #expect(try move.applying(to: trip, dayID: "empty").days[1].stops == [a])
        var changed = trip
        changed.days[0].stops.reverse()
        #expect(throws: TripDayEdit.Failure.self) { try move.applying(to: changed, dayID: "empty") }
        drag.destination = .init(
            scope: "B", target: .init(tripID: trip.id, dayID: "empty"), stops: [], enabled: true)
        #expect(drag.change(for: source, at: 0) == nil)
        drag.destination = .init(
            scope: "A", target: .init(tripID: "different", dayID: "empty"), stops: [], enabled: true)
        #expect(drag.change(for: source, at: 0) == nil)
        drag.end()
        #expect(drag.source == nil && drag.change(for: source, at: 0) == nil)
    }
    @Test func nativeListRetainsTheHeldSourceAcrossDayAndEmptyDestinationUpdates() async throws {
        let a = Trip.Stop(park: try park("A"))
        let b = Trip.Stop(park: try park("B"))
        func content(_ dayID: String, _ stops: [Trip.Stop]) -> RouteStopList {
            RouteStopList(
                destination: .init(
                    scope: "user", target: .init(tripID: "trip", dayID: dayID),
                    stops: stops, enabled: true), scrolling: true, bottomInset: 24,
                atTopChanged: { _ in }, dragChanged: { _ in }, commit: { _ in },
                header: AnyView(Text("Day")), footer: AnyView(Text("Notes")),
                row: { stop, _, _ in AnyView(Text(stop.name).frame(height: 60)) })
        }
        func table(in view: UIView) -> UITableView? {
            (view as? UITableView) ?? view.subviews.lazy.compactMap { table(in: $0) }.first
        }
        let host = UIHostingController(rootView: content("one", [a, b]))
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKeyAndVisible()
        }
        host.view.layoutIfNeeded()
        try await eventually { table(in: host.view) != nil }
        let native = try #require(table(in: host.view))
        let drag = try #require(native.dragDelegate as? RouteStopDragCoordinator)
        let pickup = try #require(drag.pickupFeedback)
        let insertion = try #require(drag.positionFeedback)
        let haptics: [UIFeedbackGenerator] = [pickup, insertion]
        #expect(haptics.allSatisfy { $0.view === native && $0.view?.window === window })
        #expect(haptics.allSatisfy { generator in native.interactions.contains { $0 === generator } })
        _ = drag.begin(at: 0)
        let session = try #require(drag.source)
        host.rootView = content("two", [])
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        try await eventually { drag.destination?.target.dayID == "two" }
        #expect(table(in: host.view) === native)
        #expect(drag.source?.sessionID == session.sessionID)
        #expect(drag.change(for: session, at: 0) != nil)
        host.rootView = content("one", [a, b])
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        try await eventually { drag.destination?.target.dayID == "one" }
        #expect(table(in: host.view) === native)
        #expect(drag.source?.stopID == a.id)
        let coordinator = try #require(native.dataSource as? RouteStopList.Coordinator)
        let settlement = drag.beginSettlement()
        #expect(drag.movePreview(session, 1, native) == IndexPath(row: 1, section: 1))
        #expect(coordinator.displayedStops == [b, a])
        #expect(
            coordinator.parent.destination.stops == [a, b], "The animation never mutates the model input")
        let preview = try #require(
            drag.tableView(native, dragPreviewParametersForRowAt: IndexPath(row: 1, section: 1)))
        #expect(preview.backgroundColor.cgColor.alpha == 1)
        host.rootView = content("one", [b, a])
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        try await eventually { coordinator.pending != nil }
        #expect(coordinator.parent.destination.stops == [a, b])
        #expect(native.numberOfRows(inSection: 1) == 2)
        drag.end()
        #expect(drag.isSettling && coordinator.parent.destination.stops == [a, b])
        drag.animationFinished(settlement)
        try await eventually { coordinator.parent.destination.stops == [b, a] }
        #expect(coordinator.pending == nil && !drag.isSettling)
        #expect(coordinator.displayedStops == [b, a])
        #expect(table(in: host.view) === native && native.numberOfRows(inSection: 1) == 2)
        drag.detachFeedback()
        #expect(haptics.allSatisfy { $0.view == nil })
        #expect(haptics.allSatisfy { generator in !native.interactions.contains { $0 === generator } })
    }
    @Test func dragFeedbackTracksInsertionChangesAndLateAnimationsCannotResumeCancelledDrops() throws {
        let a = Trip.Stop(park: try park("A"))
        let b = Trip.Stop(park: try park("B"))
        var feedback: [RouteStopDragCoordinator.Feedback] = []
        let drag = RouteStopDragCoordinator { feedback.append($0) }
        drag.destination = .init(
            scope: "user", target: .init(tripID: "trip", dayID: "one"), stops: [a, b], enabled: true)
        _ = drag.begin(at: 0)
        drag.lifted()
        drag.hover(at: 0)
        drag.hover(at: 1)
        drag.hover(at: 1)
        drag.hover(at: 500)
        #expect(feedback == [.pickup, .insertion])
        drag.destination = .init(
            scope: "user", target: .init(tripID: "trip", dayID: "empty"), stops: [], enabled: true)
        drag.hover(at: 0)
        drag.hover(at: 0)
        #expect(feedback == [.pickup, .insertion, .insertion])
        var resumed = 0
        drag.settled = { resumed += 1 }
        let first = drag.beginSettlement()
        drag.animationFinished(first)
        #expect(drag.isSettling && resumed == 0)
        drag.end()
        #expect(!drag.isSettling && resumed == 1)
        drag.animationFinished(first)
        #expect(resumed == 1)
        let cancelled = drag.beginSettlement()
        drag.cancel()
        drag.animationFinished(cancelled)
        #expect(!drag.isSettling && drag.source == nil && resumed == 1)
    }
    @Test(arguments: [false, true], [false, true])
    func nativeDropPreviewWaitsForStoreThenAcceptsOrReverts(accepted: Bool, crossDay: Bool) async throws {
        let a = Trip.Stop(park: try park("A"))
        let b = Trip.Stop(park: try park("B"))
        func content(_ stops: [Trip.Stop], enabled: Bool, day: String = "one") -> RouteStopList {
            RouteStopList(
                destination: .init(
                    scope: "user", target: .init(tripID: "trip", dayID: day),
                    stops: stops, enabled: enabled), scrolling: true, bottomInset: 0,
                atTopChanged: { _ in }, dragChanged: { _ in }, commit: { _ in },
                header: AnyView(EmptyView()), footer: AnyView(EmptyView()),
                row: { stop, _, _ in AnyView(Text(stop.name)) })
        }
        let owner = RouteStopList.Coordinator(content([a, b], enabled: true))
        let table = UITableView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        table.register(UITableViewCell.self, forCellReuseIdentifier: "route-stop")
        table.dataSource = owner
        table.delegate = owner
        table.reloadData()
        table.layoutIfNeeded()
        owner.update(content([a, b], enabled: true), on: table)
        owner.drag.settled = { [weak owner, weak table] in
            if let owner, let table { owner.resumeUpdates(on: table) }
        }
        _ = owner.drag.begin(at: 0)
        let source = try #require(owner.drag.source)
        let day = crossDay ? "two" : "one"
        let original = crossDay ? [] : [a, b]
        let preview = crossDay ? [a] : [b, a]
        let row = crossDay ? 0 : 1
        if crossDay { owner.update(content(original, enabled: true, day: day), on: table) }
        let settlement = owner.drag.beginSettlement()
        #expect(owner.movePreview(source, to: row, on: table) == IndexPath(row: row, section: 1))
        owner.update(content(original, enabled: false, day: day), on: table)
        owner.drag.end()
        owner.drag.animationFinished(settlement)
        #expect(owner.displayedStops == preview, "A slow store does not snap the preview back prematurely")
        #expect(owner.parent.destination.stops == original)
        let final = accepted ? preview : original
        owner.update(content(final, enabled: true, day: day), on: table)
        #expect(owner.displayedStops == final && owner.parent.destination.stops == final)
        #expect(table.numberOfRows(inSection: 1) == final.count)
    }
    @Test func membershipRemovalHandlesAliasesAndBookendsAndPreservesOtherDays() throws {
        let legacy = try park("old")
        let canonical = try park("new", aliases: [legacy.id])
        let b = Trip.Stop(park: try park("B"))
        var trip = Trip(days: [
            .init(id: "one", stops: [.init(park: legacy), b]), .init(id: "two", stops: [.init(park: legacy)]),
        ])
        trip.start = .init(park: legacy)
        let changed = try TripDayEdit.removePark(Set([canonical.id] + canonical.aliases)).applying(
            to: trip, dayID: "one")
        #expect(changed.start == nil && changed.days[0].stops == [b])
        #expect(changed.days[1] == trip.days[1])
    }
    @Test func numbersAreTransientAndReuseKeepsMarkerSizeAndState() throws {
        let park = try park("A")
        let view = ParkAnnotationView(annotation: ParkAnnotation(park: park), reuseIdentifier: "park")
        let size = view.bounds.size
        view.configure(park: park, clustering: false, visited: true, numbers: [1, 3])
        #expect(view.accessibilityValue?.contains("Stop 1, 3") == true)
        #expect(view.subviews.compactMap { $0 as? UILabel }.first?.text == "1, 3")
        #expect(view.bounds.size == size)
        view.prepareForReuse()
        #expect(view.subviews.compactMap { $0 as? UILabel }.first?.isHidden == true)
    }
}
