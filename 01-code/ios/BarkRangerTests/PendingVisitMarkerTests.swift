import BarkDomain
import MapKit
import Testing
import XCTest

@testable import BarkRanger

@MainActor struct PendingVisitMarkerTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func addUpgradeRemoveAndVerifiedAddWaitForReceiptsWithoutRebuildingTheMap() async throws {
        let f = try await NativeAdventureAppFixture.make()
        await f.offline()
        let context = f.context
        let account = f.session
        let repository = f.visits.repository
        let sync = NativeVisitSync(store: f.store, cloud: f.visitCloud)
        let catalog = try #require(await context.catalog.current().snapshot)
        let park = try #require(catalog.parks.first)
        let probe = ControlledParkResults()
        let model = MapFeatureModel(
            catalog: context.catalog, settings: context.settings, location: LocationClient(manager: nil),
            maps: MapsHandoff(open: { _ in true }), computeResults: probe.compute, account: account)
        model.start()
        defer { model.stop() }
        try await eventually { model.projection != nil }
        let map = PendingVisitMap(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let coordinator = MapCoordinator(model: model)
        coordinator.apply(to: map)
        let annotation = try #require(coordinator.annotations[park.id])
        let pin = try #require(map.view(for: annotation) as? ParkAnnotationView)
        let annotationVersion = model.annotationVersion
        let searches = await probe.inputs.count
        let baselineColor = try #require(stateRing(pin).strokeColor)
        map.annotationChanges = 0

        for action in ["manual", "upgrade", "remove", "verified"] {
            switch action {
            case "manual": try await repository.mark(park: park)
            case "remove": try await repository.remove([repository.workingState(park: park)])
            default:
                try await repository.mark(
                    park: park,
                    fix: LocationFix(coordinate: park.coordinate, accuracy: 10, date: Date()))
            }
            let operation = try #require(try await repository.store.nextVisitSubmission()?.submission)
            try await eventually {
                coordinator.apply(to: map)
                return pin.accessibilityValue?.contains("Visit change not confirmed") == true
            }
            #expect(try stateRing(pin).strokeColor == Self.pendingColor.cgColor)
            #expect(model.personal?.value.visited.contains(park.id) == (action != "remove"))
            // A retry or sheet movement cannot acknowledge a visit or rebuild pins.
            try await repository.store.deferSubmission(operation.id, until: .distantPast)
            #expect(try await repository.store.nextVisitSubmission()?.submission.attempts == 1)
            for height in [180.0, 440.0, 700.0] { coordinator.apply(to: map, detailFramingHeight: height) }
            #expect(try stateRing(pin).strokeColor == Self.pendingColor.cgColor)
            #expect(try await sync.synchronize().pendingCount == 0)
            try await eventually {
                coordinator.apply(to: map)
                return pin.accessibilityValue?.contains("Visit change not confirmed") == false
            }
            #expect(
                try stateRing(pin).strokeColor
                    == (action == "remove" ? baselineColor : UIColor.systemGreen.cgColor))
            #expect(coordinator.annotations[park.id] === annotation)
            #expect(map.annotationChanges == 0 && model.annotationVersion == annotationVersion)
            #expect(await probe.inputs.count == searches)
        }
        model.stop()
        await f.close()
    }

    @Test func overlappingChangesAndAccountSwitchKeepTheQueueAuthoritative() async throws {
        let f = try await NativeOfflineAccountFixture.make()
        let account = f.session
        let repository = try #require(account.nativeVisits?.repository)
        let park = Park(
            id: .init(rawValue: "park-a"), siteID: .init(rawValue: "site-a"),
            name: "Park", coordinate: try #require(Coordinate(latitude: 40, longitude: -80)))
        let projection = PersonalParkProjection(account: account)
        projection.start()
        try await repository.mark(park: park)
        try await repository.mark(
            park: park, fix: .init(coordinate: park.coordinate, accuracy: 10, date: Date()))
        #expect(try await repository.store.visitQueue().count == 2)
        try await eventually { projection.value.visitIsUnconfirmed(for: park) }
        f.auth.select("b")
        try await eventually { account.nativeProfile?.uid == "b" }
        #expect(projection.value == .init())
        f.auth.select("a")
        try await eventually {
            account.nativeProfile?.uid == "a" && projection.value.visitIsUnconfirmed(for: park)
        }
        let reopened = try #require(account.nativeVisits?.repository.store)
        #expect(try await reopened.visitQueue().count == 2)
        let head = try #require(try await reopened.nextVisitSubmission()?.submission)
        try await reopened.rejectVisitOperation(head.id, code: "invalid")
        #expect(try await reopened.visitQueue().first?.needsDecision == true)
        #expect(projection.value.visitIsUnconfirmed(for: park), "Rejected work must not look confirmed")
        projection.stop()
        try await f.close()
    }

    @Test(arguments: [ParkCategory.national, .state])
    func pendingStyleResolvesAliasesAndRestoresTripSelectionAndReuse(_ category: ParkCategory) throws {
        let alias = ParkID(rawValue: "legacy-park")
        let park = Park(
            id: .init(rawValue: "canonical"), siteID: .init(rawValue: "site"), name: "Park",
            coordinate: try #require(Coordinate(latitude: 44, longitude: -68)), category: category,
            aliases: [alias])
        let day = TripDayColor.Assignment(dayID: "third", index: 2, color: TripDayColor.palette[2])
        let confirmed = PersonalParkProjection.Value(visited: [alias], days: [alias: day])
        var pending = confirmed
        pending.unconfirmedVisits = [alias]
        #expect(pending.visitIsUnconfirmed(for: park))
        #expect(pending.changedMarkers(from: confirmed) == [alias])
        #expect(confirmed.changedMarkers(from: pending) == [alias])
        let pin = ParkAnnotationView(annotation: ParkAnnotation(park: park), reuseIdentifier: "park")
        pin.configure(park: park, clustering: true, visited: true, visitUnconfirmed: true, day: day)
        pin.setSelected(true, animated: false)
        let selection = try #require(
            pin.layer.sublayers?.first { $0.name == "park.selected" } as? CAShapeLayer)
        let visit = try #require(pin.layer.sublayers?.first { $0.name == "park.visited" } as? CAShapeLayer)
        #expect(try stateRing(pin).strokeColor == Self.pendingColor.cgColor)
        #expect(!selection.isHidden && selection.strokeColor == UIColor.systemYellow.cgColor)
        #expect(visit.isHidden)
        #expect(try stateRing(pin).lineWidth == 2.5 && selection.lineWidth == 4)
        pin.configure(park: park, clustering: true, visited: true, day: day)
        #expect(try stateRing(pin).strokeColor == day.color.uiColor.cgColor)
        #expect(!visit.isHidden && !selection.isHidden)
        pin.prepareForReuse()
        pin.configure(park: park, clustering: true)
        #expect(pin.accessibilityValue?.contains("Visit change not confirmed") == false)
        #expect(selection.isHidden && visit.isHidden)
        #expect(try stateRing(pin).strokeColor == stateRing(pin).fillColor)
        #expect(pin.bounds.size == CGSize(width: 44, height: 54))
    }

    private func stateRing(_ pin: ParkAnnotationView) throws -> CAShapeLayer {
        try #require(pin.layer.sublayers?.first { $0.name == "park.state" } as? CAShapeLayer)
    }
    private static var pendingColor: UIColor { UIColor(red: 1, green: 0.9, blue: 0.45, alpha: 1) }
}

nonisolated final class PendingVisitMarkerRenderingTests: XCTestCase {
    @MainActor func testConfirmedPendingAndSelectedAppearances() throws {
        let park = Park(
            id: .init(rawValue: "preview"), siteID: .init(rawValue: "site"), name: "Park",
            coordinate: try XCTUnwrap(Coordinate(latitude: 44, longitude: -68)), category: .national)
        let day = TripDayColor.Assignment(dayID: "third", index: 2, color: TripDayColor.palette[2])
        let canvas = UIView(frame: CGRect(x: 0, y: 0, width: 440, height: 250))
        canvas.backgroundColor = UIColor(white: 0.1, alpha: 1)
        let labels = ["Confirmed", "Not confirmed", "Selected + pending", "Confirmed again"]
        for index in 0..<8 {
            let column = index % 4
            let pin = ParkAnnotationView(annotation: ParkAnnotation(park: park), reuseIdentifier: "park")
            pin.configure(
                park: park, clustering: false, visited: true,
                visitUnconfirmed: column == 1 || column == 2, day: index >= 4 ? day : nil)
            pin.setSelected(column == 2, animated: false)
            pin.center = CGPoint(x: 55 + column * 110, y: 40 + index / 4 * 120)
            canvas.addSubview(pin)
            let label = UILabel(
                frame: CGRect(x: column * 110, y: 70 + index / 4 * 120, width: 110, height: 40))
            label.text = labels[column] + (index >= 4 ? "\nIn Day 3" : "\nVisited")
            label.font = .systemFont(ofSize: 10)
            label.textAlignment = .center
            label.numberOfLines = 3
            label.textColor = .white
            canvas.addSubview(label)
        }
        let image = UIGraphicsImageRenderer(size: canvas.bounds.size).image {
            canvas.layer.render(in: $0.cgContext)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "Pending visit pale yellow; selection bright yellow; confirmed colors restored"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

@MainActor private final class PendingVisitMap: MKMapView {
    var annotationChanges = 0
    private var pins: [ParkID: ParkAnnotationView] = [:]
    override func view(for annotation: any MKAnnotation) -> MKAnnotationView? {
        guard let park = annotation as? ParkAnnotation else { return nil }
        if pins[park.park.id] == nil {
            pins[park.park.id] = ParkAnnotationView(annotation: park, reuseIdentifier: "park")
        }
        return pins[park.park.id]
    }
    override func addAnnotations(_ annotations: [any MKAnnotation]) {
        annotationChanges += 1
        super.addAnnotations(annotations)
    }
    override func removeAnnotations(_ annotations: [any MKAnnotation]) {
        annotationChanges += 1
        super.removeAnnotations(annotations)
    }
}
