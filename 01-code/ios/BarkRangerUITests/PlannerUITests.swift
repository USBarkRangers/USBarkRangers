import XCTest

// Current guest/visual checks. Retired web-account workflows are covered by the native UI suites.
nonisolated final class PlannerUITests: XCTestCase {
    @MainActor func testCompactDayColorAndRemovalConfirmation() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        tapTab("Trips", app: app)
        if app.buttons["Trip options"].waitForExistence(timeout: 2) { app.buttons["Trip options"].tap() }
        app.buttons["New trip"].tap()
        app.buttons["route-day-title"].tap()
        XCTAssertFalse(app.buttons["Choose Trip Start"].exists)
        XCTAssertFalse(app.buttons["Choose Trip Finish"].exists)
        app.buttons["Day Color"].tap()
        capture(app, "Planner — individual day-color swatches")
        app.buttons["Red"].tap()
        XCTAssertTrue(app.buttons["Red"].waitForNonExistence(timeout: 3))
        capture(app, "Planner — compact day card with chosen red outline")
        app.buttons["route-day-title"].tap()
        app.buttons["Day Color"].tap()
        XCTAssertTrue(app.buttons["Red"].isSelected)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.08)).tap()
        app.buttons.matching(identifier: "Add day").firstMatch.tap()
        app.alerts.buttons["Add Day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.buttons["route-day-title"].tap()
        app.buttons["Remove Day"].tap()
        XCTAssertTrue(app.alerts.buttons["Remove Day"].waitForExistence(timeout: 5))
        app.alerts.buttons["Remove Day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 1"))
        XCTAssertFalse(app.buttons["Previous day"].isEnabled)
    }
    @MainActor private func tapTab(_ title: String, app: XCUIApplication) {
        let button = app.tabBars.buttons[title]
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        button.tap()
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let item = XCTAttachment(screenshot: app.screenshot())
        item.name = name
        item.lifetime = .keepAlways
        add(item)
    }
}
