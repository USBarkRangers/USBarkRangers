import XCTest

nonisolated final class RouteDayUITests: XCTestCase {
    @MainActor func testMapDayDetentsAddParkNotesAndPlannerShareTheSameDraft() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Map"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        app.tabBars.buttons["Map"].tap()
        let handle = app.otherElements["route-day-handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        XCTAssertEqual(handle.value as? String, "Low")
        if !app.descendants(matching: .any)["route-day-title"].exists { print(app.debugDescription) }
        XCTAssertTrue(app.descendants(matching: .any)["route-day-title"].exists)
        XCTAssertTrue(app.textFields["park-search"].isHittable)
        capture(app, "Route day — compact low")
        handle.tap()
        expectValue("Medium", element: handle)
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("hulls cove")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        let add = app.buttons["add-to-route-day"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        XCTAssertTrue(add.label.contains("Add to Day 1"))
        add.tap()
        XCTAssertTrue(app.buttons["park-trip-membership"].waitForExistence(timeout: 5))
        XCTAssertFalse(add.exists)
        // Adding now keeps the selected park open and replaces Add with its membership.
        app.buttons["Close park details"].tap()
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        expectValue("Low", element: handle)
        handle.tap()
        expectValue("Medium", element: handle)
        XCTAssertEqual(
            app.otherElements.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "route-stop-")
            ).count, 1)
        XCTAssertTrue(app.tabBars.buttons["Trips"].isHittable)
        capture(app, "Route day — medium after adding park")
        handle.tap()
        expectValue("High", element: handle)
        XCTAssertFalse(app.textFields["park-search"].isHittable)
        XCTAssertFalse(app.tabBars.buttons["Trips"].isHittable)
        capture(app, "Route day — high controls")
        XCTAssertFalse(app.buttons["Add Stop"].exists)
        XCTAssertFalse(app.buttons["Optimize Day"].exists)
        XCTAssertFalse(app.buttons["Add Day Note"].exists)
        app.buttons["route-day-title"].tap()
        let notes = app.buttons["Add Day Note"]
        XCTAssertTrue(notes.isHittable)
        notes.tap()
        let editor = app.textViews["Day notes"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText("Map day note")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Map day note"].waitForExistence(timeout: 5))
        app.buttons["Close day"].tap()
        XCTAssertTrue(app.tabBars.buttons["Trips"].isHittable)
        app.tabBars.buttons["Trips"].tap()
        let plannerNotes = app.staticTexts["Map day note"]
        for _ in 0..<6 where !plannerNotes.isHittable { app.tables["route-stop-list"].swipeUp() }
        XCTAssertTrue(plannerNotes.isHittable)
        capture(app, "Planner sees the same map draft")
    }
    @MainActor func testDirectStopDragNotesInsertBelowAndTripVisibility() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Map"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        app.tabBars.buttons["Map"].tap()
        let handle = app.otherElements["route-day-handle"]
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        for query in ["hulls cove", "pilot mountain", "cuyahoga"] { addPark(query, app: app) }
        handle.tap()
        expectValue("High", element: handle)
        XCTAssertFalse(app.buttons["Reorder"].exists)
        XCTAssertFalse(app.buttons["Done reordering"].exists)
        let rows = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route-stop-"))
        if rows.count != 3 { print(app.debugDescription) }
        XCTAssertEqual(rows.count, 3)
        guard rows.count == 3 else { return }
        let original = rows.allElementsBoundByIndex.map(\.identifier)
        let first = rows.element(boundBy: 0)
        let last = rows.element(boundBy: 2)
        first.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.65)).press(
            forDuration: 0.6, thenDragTo: last.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.95)),
            withVelocity: .slow, thenHoldForDuration: 0.3)
        let moved = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                MainActor.assumeIsolated {
                    rows.allElementsBoundByIndex.map(\.identifier) == [original[1], original[2], original[0]]
                }
            }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [moved], timeout: 5), .completed)
        XCTAssertEqual(handle.value as? String, "High", "Dragging a stop must not collapse the sheet")
        capture(app, "Stops reordered by native long press")
        let menu = rows.element(boundBy: 0).buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "Options for")
        ).firstMatch
        menu.tap()
        XCTAssertTrue(app.buttons["Add Note"].exists)
        XCTAssertTrue(app.buttons["Add Stop Below"].exists)
        XCTAssertFalse(app.buttons["Reorder"].exists)
        app.buttons["Add Note"].tap()
        let note = app.textViews["Stop note"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.tap()
        note.typeText("Bring water for this stop")
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Bring water for this stop"].waitForExistence(timeout: 5))
        menu.tap()
        app.buttons["Add Stop Below"].tap()
        let search = app.textFields["park-search"]
        XCTAssertTrue(search.isHittable)
        addPark("zion", app: app)
        handle.tap()
        expectValue("High", element: handle)
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows.element(boundBy: 0).identifier, original[1])
        XCTAssertEqual(rows.element(boundBy: 2).identifier, original[2])
        XCTAssertEqual(rows.element(boundBy: 3).identifier, original[0])
        app.buttons["Close day"].tap()
        XCTAssertTrue(handle.waitForNonExistence(timeout: 5))
        let tripChip = app.buttons["map-displayed-trip"]
        XCTAssertTrue(tripChip.isHittable)
        XCTAssertFalse(app.buttons["Choose Trip"].exists)
        let clear = app.buttons["Clear trip"]
        XCTAssertTrue(clear.isEnabled)
        XCTAssertGreaterThanOrEqual(clear.frame.width, 44)
        XCTAssertGreaterThanOrEqual(clear.frame.height, 44)
        clear.tap()
        XCTAssertTrue(tripChip.waitForNonExistence(timeout: 5))
        XCTAssertFalse(handle.exists)
        app.tabBars.buttons["Trips"].tap()
        app.buttons["Switch trip"].tap()
        let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "switch-trip-"))
            .firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5), "Clearing must retain the trip")
        saved.tap()
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(tripChip.waitForExistence(timeout: 5))
        XCTAssertFalse(handle.exists, "Restoring a trip does not reopen the day the user closed")
        search.tap()
        if app.buttons["Clear search"].exists { app.buttons["Clear search"].tap() }
        search.typeText("hulls cove")
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        XCTAssertTrue(app.descendants(matching: .any)["park-trip-membership"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["add-to-route-day"].exists)
        XCTAssertFalse(app.buttons["Add to Trip"].exists)
        capture(app, "Existing trip park displays its day membership")
        app.buttons["park-trip-membership"].tap()
        XCTAssertTrue(app.buttons["Remove from Day 1"].exists)
        app.buttons["Edit Day 1"].tap()
        expectValue("High", element: handle)
        XCTAssertEqual(rows.count, 4)
    }
    @MainActor private func addPark(_ query: String, app: XCUIApplication) {
        let handle = app.otherElements["route-day-handle"]
        let search = app.textFields["park-search"]
        search.tap()
        if app.buttons["Clear search"].exists { app.buttons["Clear search"].tap() }
        search.typeText(query)
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        let add = app.buttons["add-to-route-day"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.buttons["park-trip-membership"].waitForExistence(timeout: 5))
        XCTAssertFalse(add.exists)
        app.buttons["Close park details"].tap()
        // Focusing search intentionally collapses the day; dismissing a park retains that height.
        expectValue("Low", element: handle)
        handle.tap()
        expectValue("Medium", element: handle)
    }
    @MainActor private func expectValue(_ value: String, element: XCUIElement) {
        let expected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 5), .completed)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
