import XCTest

nonisolated final class PlannerUITests: XCTestCase {
    @MainActor func testSharedDayCardDragBookendsAndPreviewHandoff() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_ACCOUNT_EMULATORS"] = "1"
        app.launchEnvironment["BARK_EMULATOR_HOST"] = "127.0.0.1"
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Account"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Account"].tap()
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("ranger-a@example.test")
        app.secureTextFields["Password"].tap()
        app.secureTextFields["Password"].typeText("BarkTest123!")
        app.buttons["Sign in"].tap()
        XCTAssertTrue(app.textFields["New display name"].waitForExistence(timeout: 10))
        if app.sheets["Save Password?"].waitForExistence(timeout: 2) {
            app.sheets["Save Password?"].buttons["Not Now"].tap()
        }
        tapTab("Trips", app: app)
        if app.buttons["Trip options"].waitForExistence(timeout: 2) { app.buttons["Trip options"].tap() }
        app.buttons["New trip"].tap()
        XCTAssertTrue(app.otherElements["planner-day-card"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["This day"].exists)
        XCTAssertFalse(app.staticTexts["Start and finish"].exists)
        choosePark("zion", action: "Add Stop", app: app)
        choosePark("cuyahoga", action: "Add Stop", app: app)
        let rows = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route-stop-"))
        XCTAssertEqual(rows.count, 2)
        guard rows.count == 2 else { return }
        let original = rows.allElementsBoundByIndex.map(\.identifier)
        rows.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.6)).press(
            forDuration: 0.6,
            thenDragTo: rows.element(boundBy: 1).coordinate(
                withNormalizedOffset: CGVector(dx: 0.3, dy: 0.98)),
            withVelocity: .slow, thenHoldForDuration: 0.3)
        let moved = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                MainActor.assumeIsolated {
                    rows.allElementsBoundByIndex.map(\.identifier) == original.reversed()
                }
            }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 5), .completed)
        capture(app, "Planner — shared timeline after native drag")
        choosePark("pilot mountain", action: "Choose Trip Start", app: app)
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Start ·")).firstMatch.exists)
        app.buttons.matching(identifier: "Add day").firstMatch.tap()
        app.alerts.buttons["Add Day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        app.buttons["Trip options"].tap()
        XCTAssertTrue(app.buttons["Edit Trip Start"].exists)
        app.buttons["Choose Trip Finish"].tap()
        pickPark("grand canyon", app: app)
        choosePark("yellowstone", action: "Add Stop", app: app)
        app.segmentedControls.buttons["Overview"].tap()
        let status = app.staticTexts["trip-save-status"]
        let statusFrame = status.frame
        app.buttons["Save to account"].tap()
        let saved = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS 'Your account confirms it when connected.'"),
            object: status)
        XCTAssertEqual(XCTWaiter.wait(for: [saved], timeout: 10), .completed)
        XCTAssertTrue(status.isHittable)
        XCTAssertEqual(status.frame.minY, statusFrame.minY, accuracy: 1)
        capture(app, "Save result visible in Overview's shared header")
        app.segmentedControls.buttons["Planner"].tap()
        XCTAssertTrue(status.label.contains("Your account confirms it when connected."))
        app.buttons["route-day-title"].tap()
        app.buttons["Add Day Note"].tap()
        let note = app.textViews["Day notes"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        XCTAssertFalse(
            app.staticTexts["Saved on this iPhone. Your account confirms it when connected."].isHittable,
            "A new note must not show the trip's success as a form error")
        capture(app, "New Day Note starts without unrelated feedback")
        note.tap()
        note.typeText("Plan a relaxed second day")
        app.navigationBars.buttons["Save"].tap()
        let table = app.tables["route-stop-list"]
        for _ in 0..<6 where !app.staticTexts["Plan a relaxed second day"].isHittable { table.swipeUp() }
        XCTAssertTrue(app.staticTexts["Plan a relaxed second day"].isHittable)
        capture(app, "Planner — day notes stay inside the day card")
        let preview = app.buttons["planner-preview-map"]
        let cards = app.scrollViews["planner-cards"]
        for _ in 0..<5 where !preview.isHittable {
            cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.85)).press(
                forDuration: 0.05,
                thenDragTo: cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.2)))
        }
        XCTAssertTrue(preview.isEnabled && preview.isHittable)
        capture(app, "Planner — separate Plan trip card")
        preview.tap()
        XCTAssertTrue(app.tabBars.buttons["Map"].isSelected)
        let handle = app.otherElements["route-day-handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 8))
        XCTAssertEqual(handle.value as? String, "Medium")
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        capture(app, "Preview opens the same day on Map")
        tapTab("Trips", app: app)
        XCTAssertTrue(app.otherElements["planner-day-card"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 2"))
        for _ in 0..<5 where !app.buttons["Previous day"].isHittable {
            cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.2)).press(
                forDuration: 0.05,
                thenDragTo: cards.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.85)))
        }
        app.buttons["Previous day"].tap()
        XCTAssertTrue(app.buttons["route-day-title"].label.contains("Day 1"))
        capture(app, "Planner — return from Map retains itinerary")
    }
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
    @MainActor private func choosePark(_ query: String, action: String, app: XCUIApplication) {
        app.buttons[action.contains("Trip") ? "Trip options" : "route-day-title"].tap()
        app.buttons[action].tap()
        pickPark(query, app: app)
    }
    @MainActor private func pickPark(_ query: String, app: XCUIApplication) {
        addSearchedStop(query, app: app)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let item = XCTAttachment(screenshot: app.screenshot())
        item.name = name
        item.lifetime = .keepAlways
        add(item)
    }
}
