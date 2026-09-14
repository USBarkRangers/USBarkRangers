import XCTest

nonisolated final class TripNavigationUITests: XCTestCase {
    @MainActor func testActiveTripRootSwitchDuplicateClearDiscardAndRelaunch() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        openTrips(app)
        XCTAssertTrue(app.buttons["New trip"].waitForExistence(timeout: 5))
        app.buttons["New trip"].tap()
        expectTitle("New adventure", app)
        XCTAssertFalse(app.buttons["Continue editing"].exists)
        XCTAssertFalse(app.navigationBars.buttons.firstMatch.exists)
        let title = app.textFields["trip-name"]
        let segments = app.segmentedControls["trip-view-picker"]
        XCTAssertLessThan(title.frame.minY, app.frame.height * 0.15)
        XCTAssertLessThan(segments.frame.minY - title.frame.maxY, 20)
        rename("First trip", app)
        app.buttons["Add day"].tap()
        app.alerts.buttons["Add Day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        options(app)
        for action in ["Switch trip", "New trip", "Rename trip", "Duplicate trip", "Clear trip"] {
            XCTAssertTrue(app.buttons[action].exists)
        }
        app.buttons["New trip"].tap()
        expectTitle("New adventure", app)
        rename("Second trip", app)
        showSwitcher(app)
        XCTAssertEqual(tripRow("First trip", app).count, 1)
        XCTAssertEqual(tripRow("Second trip", app).count, 1)
        tripRow("First trip", app).firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Switch trip"].waitForNonExistence(timeout: 5))
        expectTitle("First trip", app)
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.tabBars.buttons["Home"].tap()
        openTrips(app)
        expectTitle("First trip", app)
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.terminate()
        app.launch()
        openTrips(app)
        expectTitle("First trip", app)
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        capture(app, "Trips opens the active editor directly")

        options(app)
        app.buttons["Duplicate trip"].tap()
        expectTitle("First trip copy", app)
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        showSwitcher(app)
        for name in ["First trip", "Second trip", "First trip copy"] {
            XCTAssertEqual(tripRow(name, app).count, 1)
        }
        capture(app, "Switch trips in a sheet")
        app.navigationBars["Switch trip"].buttons["Done"].tap()
        options(app)
        XCTAssertFalse(app.buttons["Delete trip"].exists)
        app.buttons["Clear trip"].tap()
        XCTAssertTrue(app.staticTexts["Plan your next trip"].waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        openTrips(app)
        XCTAssertTrue(app.buttons["Switch trip"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["trip-name"].exists)
        app.buttons["Switch trip"].tap()
        let copy = tripRow("First trip copy", app).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        copy.swipeLeft()
        app.buttons["Discard trip"].tap()
        XCTAssertTrue(app.alerts["Discard this trip?"].waitForExistence(timeout: 3))
        app.alerts.buttons["Cancel"].tap()
        copy.swipeLeft()
        app.buttons["Discard trip"].tap()
        app.alerts.buttons["Discard trip"].tap()
        XCTAssertTrue(copy.waitForNonExistence(timeout: 5))
        XCTAssertEqual(tripRow("First trip", app).count, 1)
        XCTAssertEqual(tripRow("Second trip", app).count, 1)
        app.collectionViews["trip-switcher"].buttons["New trip"].tap()
        XCTAssertTrue(app.navigationBars["Switch trip"].waitForNonExistence(timeout: 5))
        expectTitle("New adventure", app)
    }

    @MainActor func testDeletingTheOnlyTripReturnsToNewTripState() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        openTrips(app)
        app.buttons["New trip"].tap()
        expectTitle("New adventure", app)
        showSwitcher(app)
        let trip = tripRow("New adventure", app).firstMatch
        trip.swipeLeft()
        app.buttons["Discard trip"].tap()
        app.alerts.buttons["Discard trip"].tap()
        XCTAssertTrue(trip.waitForNonExistence(timeout: 5))
        app.navigationBars["Switch trip"].buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["Plan your next trip"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["trip-name"].exists)
        XCTAssertTrue(app.buttons["New trip"].isEnabled)
        app.terminate()
        app.launch()
        openTrips(app)
        XCTAssertTrue(app.buttons["New trip"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["trip-name"].exists)
    }

    @MainActor private func openTrips(_ app: XCUIApplication) {
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
    }
    @MainActor private func options(_ app: XCUIApplication) {
        // A completed day edit uses the existing success message in the same save-status slot.
        let saved = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label IN %@", ["Draft saved on this iPhone", "Day updated"]),
            object: app.staticTexts["trip-save-status"])
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 5), .completed)
        app.buttons["Trip options"].tap()
    }
    @MainActor private func showSwitcher(_ app: XCUIApplication) {
        options(app)
        app.buttons["Switch trip"].tap()
        XCTAssertTrue(app.navigationBars["Switch trip"].waitForExistence(timeout: 5))
    }
    @MainActor private func tripRow(_ name: String, _ app: XCUIApplication) -> XCUIElementQuery {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name + ","))
    }
    @MainActor private func rename(_ name: String, _ app: XCUIApplication) {
        options(app)
        app.buttons["Rename trip"].tap()
        let field = app.textFields["trip-name"]
        let old = field.value as? String ?? ""
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count) + name + "\n")
        expectTitle(name, app)
    }
    @MainActor private func expectTitle(_ title: String, _ app: XCUIApplication) {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", title),
            object: app.textFields["trip-name"])
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 6), .completed)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
