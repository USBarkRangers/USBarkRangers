import BarkDomain
import MapKit
import SwiftUI
import XCTest

@testable import BarkRanger

nonisolated final class DayStatsLayoutTests: XCTestCase {
    @MainActor func testPlannerConfirmationExpiresWithoutMovingTheStopList() async throws {
        let fixture = try await PlannerFixture.make()
        defer { fixture.context.close() }
        let model = fixture.model()
        model.open(fixture.a)
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        defer {
            window.isHidden = true
            previous?.makeKeyAndVisible()
            model.resetScope()
        }
        let host = UIHostingController(
            rootView: TripEditorView(
                model: model, units: .miles, previewDay: { _ in }, switchTrip: {}))
        window.rootViewController = host
        window.makeKeyAndVisible()
        try await Task.sleep(for: .milliseconds(100))
        host.view.layoutIfNeeded()
        let table = try XCTUnwrap(findTable(in: host.view))
        let original = table.convert(table.bounds, to: window)
        model.setColor(TripDayColor.palette[1].hex)
        let saved = await model.awaitCheckpoint()
        XCTAssertTrue(saved)
        XCTAssertEqual(model.notice, "Day updated")
        try await Task.sleep(for: .milliseconds(100))
        host.view.layoutIfNeeded()
        XCTAssertEqual(table.convert(table.bounds, to: window).minY, original.minY, accuracy: 0.5)
        try await Task.sleep(for: .milliseconds(3100))
        host.view.layoutIfNeeded()
        XCTAssertNil(model.notice, "Planner confirmation should last only three seconds")
        XCTAssertEqual(table.convert(table.bounds, to: window).minY, original.minY, accuracy: 0.5)
        XCTAssertEqual(table.convert(table.bounds, to: window).height, original.height, accuracy: 0.5)
        await fixture.session.stopAndWait()
    }

    @MainActor private func findTable(in view: UIView) -> UITableView? {
        (view as? UITableView) ?? view.subviews.lazy.compactMap { self.findTable(in: $0) }.first
    }

    @MainActor func testLoadingAndConfirmationDoNotChangeSummaryHeight() throws {
        let fixture = try makeFixture()
        for width: CGFloat in [280, 335, 390] {
            for size: DynamicTypeSize in [.large, .xxxLarge] {
                var heights: [CGFloat] = []
                for loading in [false, true] {
                    for updated in [false, true] {
                        let row = DayStatsRow(
                            day: fixture.day, plan: fixture.plan,
                            legs: loading ? [:] : fixture.legs, units: .miles,
                            isLoading: loading, dayUpdated: updated)
                        let host = UIHostingController(rootView: row.dynamicTypeSize(size))
                        heights.append(host.sizeThatFits(in: CGSize(width: width, height: 200)).height)
                    }
                }
                XCTAssertLessThanOrEqual(
                    try XCTUnwrap(heights.max()) - XCTUnwrap(heights.min()), 0.5,
                    "Loading/success moved the itinerary at width \(width), text size \(size)")
            }
        }
    }

    @MainActor func testInlineStatesOnBothSurfaces() throws {
        let fixture = try makeFixture()
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previous = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        defer {
            window.isHidden = true
            previous?.makeKeyAndVisible()
        }
        let host = UIHostingController(
            rootView:
                VStack(alignment: .leading, spacing: 24) {
                    ForEach([false, true], id: \.self) { planner in
                        VStack(alignment: .leading, spacing: 20) {
                            Text(planner ? "Planner" : "Map day sheet").font(.headline)
                            ForEach(0..<3) { state in
                                DayStatsRow(
                                    day: fixture.day, plan: fixture.plan,
                                    legs: state == 1 ? [:] : fixture.legs, units: .miles,
                                    isLoading: state == 1, dayUpdated: state != 0)
                            }
                        }
                        .padding(16)
                        .background(planner ? Color(uiColor: .secondarySystemGroupedBackground) : .black)
                        .clipShape(RoundedRectangle(cornerRadius: 22))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22).stroke(.orange.opacity(planner ? 0.65 : 0)))
                    }
                    Spacer()
                }
                .padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.black).tint(.teal).preferredColorScheme(.dark))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "Shared inline route feedback - Map and Planner"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor private func makeFixture() throws -> (
        day: Trip.Day, plan: TripRoutePlan.Day, legs: [String: DayRouteService.Leg]
    ) {
        let stops = try (0..<7).map { index in
            Trip.Stop(
                name: "Park \(index + 1)",
                coordinate:
                    try XCTUnwrap(Coordinate(latitude: 41, longitude: -82 + Double(index) * 0.1)))
        }
        let day = Trip.Day(id: "day", stops: stops)
        let plan = try XCTUnwrap(TripRoutePlan.build(Trip(days: [day])).days.first)
        let legs = Dictionary(
            uniqueKeysWithValues: plan.segments.map {
                (
                    $0.geometryKey,
                    DayRouteService.Leg(
                        polyline: MKPolyline(), meters: 746.8 * 1609.344 / 6, seconds: 49320 / 6)
                )
            })
        return (day, plan, legs)
    }
}
