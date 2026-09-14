import XCTest

nonisolated final class TripOverviewUITests: XCTestCase {
    @MainActor func testFinishAgreesAcrossPlannerOverviewAndMapWithAnEmptyFinalDay() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        addPark("zion", app: app)
        app.buttons["Add day"].tap()
        app.alerts.buttons["Add Day"].tap()
        app.buttons["Trip options"].tap()
        app.buttons["Choose Trip Finish"].tap()
        addSearchedStop("pilot mountain", app: app)

        let finish = "Finish · Pilot Mountain State Park"
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        XCTAssertFalse(app.staticTexts[finish].exists, "Empty final day must not claim the finish")
        app.buttons["Previous day"].tap()
        let table = app.tables["route-stop-list"]
        for _ in 0..<4 where !app.staticTexts[finish].isHittable { table.swipeUp() }
        XCTAssertTrue(app.staticTexts[finish].isHittable)
        capture(app, "Finish belongs to populated Day 1 in Planner")

        app.segmentedControls.buttons["Overview"].tap()
        let days = app.scrollViews["trip-overview"].otherElements.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "trip-overview-day-"))
        XCTAssertEqual(days.count, 2)
        XCTAssertTrue(days.element(boundBy: 0).staticTexts[finish].exists)
        XCTAssertFalse(days.element(boundBy: 1).staticTexts[finish].exists)
        capture(app, "Overview uses the same finish day")

        app.tabBars.buttons["Map"].tap()
        let membership = app.buttons["park-trip-membership"]
        XCTAssertTrue(membership.waitForExistence(timeout: 5))
        XCTAssertTrue(membership.label.contains("Day 1"))
        membership.tap()
        app.buttons["Edit Day 1"].tap()
        let handle = app.otherElements["route-day-handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        for _ in 0..<2 where handle.value as? String != "High" { handle.tap() }
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 1"))
        for _ in 0..<4 where !app.staticTexts[finish].isHittable { table.swipeUp() }
        XCTAssertTrue(app.staticTexts[finish].isHittable)
        capture(app, "Map pin and day sheet agree with Planner")
        app.buttons["Next day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        XCTAssertFalse(app.staticTexts[finish].exists)
    }

    @MainActor func testOverviewSharesTheDraftAndSwitchingPreservesPlannerInputs() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        let title = app.textFields["trip-name"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.value as? String, "New adventure")
        XCTAssertFalse(app.staticTexts["Edit trip"].exists)
        let picker = app.segmentedControls["trip-view-picker"]
        XCTAssertEqual(picker.buttons.count, 2)
        XCTAssertTrue(picker.buttons["Planner"].isSelected)
        addPark("zion", app: app)
        app.buttons["Add day"].tap()
        app.alerts.buttons["Add Day"].tap()
        addPark("cuyahoga", app: app)
        capture(app, "Trip header — Planner with existing day card")

        let cards = app.scrollViews["planner-cards"]
        let driving = app.steppers.matching(NSPredicate(format: "label BEGINSWITH %@", "Driving goal:"))
            .firstMatch
        let visit = app.steppers.matching(NSPredicate(format: "label BEGINSWITH %@", "Visit time:"))
            .firstMatch
        for _ in 0..<5 where !visit.buttons["Increment"].isHittable {
            cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.85)).press(
                forDuration: 0.05,
                thenDragTo: cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.25)))
        }
        XCTAssertTrue(driving.buttons["Increment"].isHittable && visit.buttons["Increment"].isHittable)
        driving.buttons["Increment"].tap()
        visit.buttons["Increment"].tap()
        XCTAssertTrue(driving.label.contains("5 hours"))
        XCTAssertTrue(visit.label.contains("45 minutes"))
        let inputPosition = visit.frame.minY

        picker.buttons["Overview"].tap()
        let overview = app.scrollViews["trip-overview"]
        XCTAssertTrue(overview.waitForExistence(timeout: 5))
        let days = overview.otherElements.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "trip-overview-day-"))
        XCTAssertEqual(days.count, 2)
        XCTAssertTrue(days.element(boundBy: 0).staticTexts["Day 1"].exists)
        XCTAssertTrue(days.element(boundBy: 1).staticTexts["Day 2"].exists)
        XCTAssertTrue(days.element(boundBy: 0).staticTexts["Zion National Park"].exists)
        XCTAssertTrue(days.element(boundBy: 1).staticTexts["Cuyahoga Valley National Park"].exists)
        XCTAssertFalse(app.staticTexts["Road route unavailable"].isHittable)
        XCTAssertFalse(app.buttons["planner-preview-map"].isHittable)
        capture(app, "Overview — ordered days and locations only")

        picker.buttons["Planner"].tap()
        XCTAssertTrue(visit.buttons["Increment"].isHittable)
        XCTAssertEqual(visit.frame.minY, inputPosition, accuracy: 1, "Planner retains its scroll position")
        XCTAssertTrue(driving.label.contains("5 hours"))
        XCTAssertTrue(visit.label.contains("45 minutes"))
        for _ in 0..<5 where !app.buttons["route-day-title"].isHittable {
            cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.25)).press(
                forDuration: 0.05,
                thenDragTo: cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.85)))
        }
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.buttons["Add day"].tap()
        app.alerts.buttons["Add Day"].tap()
        picker.buttons["Overview"].tap()
        let third = days.element(boundBy: 2)
        for _ in 0..<3 where !third.isHittable { overview.swipeUp() }
        XCTAssertEqual(days.count, 3, "Overview reads the updated trip, not its own copy")
        XCTAssertTrue(third.staticTexts["Day 3"].exists)
        XCTAssertTrue(third.staticTexts["No locations yet"].exists)
        picker.buttons["Planner"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 3"))
        app.tabBars.buttons["Home"].tap()
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 3"))
        XCTAssertFalse(app.navigationBars.buttons["Back"].exists)
    }

    @MainActor private func addPark(_ query: String, app: XCUIApplication) {
        app.buttons["route-day-title"].tap()
        app.buttons["Add Stop"].tap()
        addSearchedStop(query, app: app)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let item = XCTAttachment(screenshot: app.screenshot())
        item.name = name
        item.lifetime = .keepAlways
        add(item)
    }
}
