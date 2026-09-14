import XCTest

nonisolated final class SharedDayControlsUITests: XCTestCase {
    @MainActor func testSharedMenuConfirmedPlusAndPreviousDayRemovalOnBothSurfaces() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        expectDay(1, app: app)
        app.buttons["Trip options"].tap()
        app.buttons["Choose Trip Start"].tap()
        addSearchedStop("zion", app: app)
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Start ·")).firstMatch.exists)
        app.buttons["Add day"].tap(withNumberOfTaps: 3, numberOfTouches: 1)
        XCTAssertTrue(app.staticTexts["Add a new day?"].waitForExistence(timeout: 3))
        app.buttons["Cancel"].tap()
        expectDay(1, app: app)
        addDay(app)
        expectDay(2, app: app)
        addDay(app)
        expectDay(3, app: app)
        addDay(app)
        expectDay(4, app: app)
        app.buttons["Previous day"].tap()
        expectDay(3, app: app)
        app.buttons["Previous day"].tap()
        expectDay(2, app: app)
        app.tabBars.buttons["Map"].tap()
        app.buttons["map-displayed-trip"].tap()
        app.buttons["New adventure · Draft"].tap()
        expectDay(2, app: app)
        app.tabBars.buttons["Trips"].tap()
        expectDay(2, app: app)
        app.buttons["Next day"].tap()
        app.buttons["Next day"].tap()
        expectDay(4, app: app)
        removeDay(app)
        expectDay(3, app: app)
        checkMenu(app)
        removeDay(app)
        expectDay(2, app: app)
        capture(app, "Shared Planner day controls — previous day after removal")
        app.tabBars.buttons["Map"].tap()
        app.buttons["map-displayed-trip"].tap()
        app.buttons["New adventure · Draft"].tap()
        expectDay(2, app: app)
        app.otherElements["route-day-handle"].tap()
        addDay(app)
        expectDay(3, app: app)
        checkMenu(app)
        app.buttons["route-day-title"].tap()
        app.buttons["Day Color"].tap()
        app.buttons["Red"].tap()
        XCTAssertTrue(app.buttons["Red"].waitForNonExistence(timeout: 3))
        app.buttons["route-day-title"].tap()
        app.buttons["Day Color"].tap()
        XCTAssertTrue(app.buttons["Red"].isSelected)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
        // A map tap may close the day. Reopen from the chip without changing its persisted selection.
        if !app.buttons["route-day-title"].isHittable {
            app.buttons["map-displayed-trip"].tap()
            app.buttons["New adventure · Draft"].tap()
        }
        expectDay(3, app: app)
        removeDay(app)
        expectDay(2, app: app)
        capture(app, "Shared Map day controls — no card ring")
        let handle = app.otherElements["route-day-handle"]
        for _ in 0..<2 where handle.value as? String != "High" { handle.tap() }
        XCTAssertEqual(handle.value as? String, "High")
        app.staticTexts["route-day-stats"].tap()
        XCTAssertEqual(handle.value as? String, "High", "Statistics are not a collapse control")
        capture(app, "High day stays expanded after a statistics tap")
        app.buttons["Close day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].waitForNonExistence(timeout: 3))
        app.tabBars.buttons["Trips"].tap()
        expectDay(2, app: app)
        XCTAssertTrue(app.otherElements["planner-day-card"].exists)
    }
    @MainActor private func checkMenu(_ app: XCUIApplication) {
        let title = app.buttons["route-day-title"]
        XCTAssertEqual(title.frame.midX, app.frame.midX, accuracy: 1)
        capture(app, "Centered current day header")
        XCTAssertFalse(app.buttons["Day options"].exists)
        title.tap()
        for title in ["Add Stop", "Add Day Note", "Day Color", "Optimize Day", "Open in Maps", "Remove Day"] {
            XCTAssertTrue(app.buttons[title].exists, title)
        }
        for title in ["Move day earlier", "Move day later", "Hide trip routes"] {
            XCTAssertFalse(app.buttons[title].exists, title)
        }
        XCTAssertFalse(app.buttons["Save to account"].isHittable)
        capture(app, "The same six day actions")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
    }
    @MainActor private func addDay(_ app: XCUIApplication) {
        app.buttons["Add day"].tap(withNumberOfTaps: 3, numberOfTouches: 1)
        XCTAssertTrue(app.alerts.buttons["Add Day"].waitForExistence(timeout: 3))
        app.alerts.buttons["Add Day"].tap()
        XCTAssertTrue(app.alerts.buttons["Add Day"].waitForNonExistence(timeout: 3))
    }
    @MainActor private func removeDay(_ app: XCUIApplication) {
        app.buttons["route-day-title"].tap()
        app.buttons["Remove Day"].tap()
        XCTAssertTrue(app.alerts.buttons["Remove Day"].waitForExistence(timeout: 3))
        app.alerts.buttons["Remove Day"].tap()
    }
    @MainActor private func expectDay(_ number: Int, app: XCUIApplication) {
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label BEGINSWITH %@", "Day \(number),"),
            object: app.buttons["route-day-title"])
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
