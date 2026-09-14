import XCTest

nonisolated final class MapTripSearchUITests: XCTestCase {
    @MainActor func testPlannerHandoffCustomPlaceMembershipMoveAndClear() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.textFields["park-search"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["map-displayed-trip"].exists)
        XCTAssertFalse(app.buttons["Choose Trip"].exists)
        XCTAssertFalse(app.buttons["Trip Routes"].exists)
        XCTAssertFalse(app.scrollViews["active-filters"].exists)
        capture(app, "Empty Map has no trip controls or empty filter rail")
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        app.buttons["route-day-title"].tap()
        app.buttons["Add Stop"].tap()
        addSearchedStop("zion", app: app)
        XCTAssertTrue(app.otherElements["planner-day-card"].exists)
        app.buttons["route-day-title"].tap()
        app.buttons["Add Stop"].tap()
        addSearchedStop("41.2, -81.5", app: app, place: true, returnToPlanner: false)
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].exists)
        XCTAssertFalse(app.buttons["Park Info"].exists)
        XCTAssertEqual(app.otherElements["park-sheet-handle"].value as? String, "Low")
        let membership = app.buttons["park-trip-membership"]
        membership.tap()
        XCTAssertFalse(app.buttons["No previous day"].isEnabled)
        app.buttons["Move to Day 2"].tap()
        expectLabel("Day 2", element: membership)
        membership.tap()
        app.buttons["Move to Day 1"].tap()
        expectLabel("Day 1", element: membership)
        capture(app, "Custom place — shared low sheet with membership and Directions")
        app.tabBars.buttons["Trips"].tap()
        XCTAssertEqual(
            app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route-stop-")).count,
            2)
        app.segmentedControls.buttons["Overview"].tap()
        XCTAssertTrue(app.staticTexts["41.2, -81.5"].exists)
        app.segmentedControls.buttons["Planner"].tap()
        app.buttons["Trip options"].tap()
        app.buttons["Clear trip"].tap()
        XCTAssertTrue(app.buttons["New trip"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Map"].tap()
        XCTAssertFalse(app.buttons["map-displayed-trip"].exists)
        XCTAssertFalse(app.buttons["Choose Trip"].exists)
        XCTAssertFalse(app.buttons["Trip Routes"].exists)
        XCTAssertFalse(app.buttons["park-trip-membership"].exists)
        capture(app, "Cleared trip no longer remains on Map")
        app.tabBars.buttons["Trips"].tap()
        app.buttons["Switch trip"].tap()
        let saved = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "switch-trip-"))
            .firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        saved.tap()
        app.tabBars.buttons["Map"].tap()
        let tripChip = app.buttons["map-displayed-trip"]
        XCTAssertTrue(tripChip.waitForExistence(timeout: 5))
        tripChip.tap()
        XCTAssertTrue(app.buttons["Show whole route"].exists)
        XCTAssertTrue(app.buttons["Retry road routes"].exists)
        XCTAssertFalse(app.buttons["New local trip"].exists)
        app.buttons["New adventure · Draft"].tap()
        app.tabBars.buttons["Trips"].tap()
        app.buttons["Trip options"].tap()
        app.buttons["New trip"].tap()
        XCTAssertTrue(app.staticTexts["0 stops"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Map"].tap()
        tripChip.tap()
        let choices = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "New adventure · Draft"))
        XCTAssertEqual(choices.count, 2)
        choices.element(boundBy: 0).tap()
        // Trip chips no longer contain stats; inspect the shared itinerary on Planner.
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.staticTexts["2 stops"].waitForExistence(timeout: 5))
        app.tabBars.buttons["Map"].tap()
        capture(app, "One trip chip switches directly on Map")
        app.buttons["Clear trip"].tap()
        XCTAssertTrue(tripChip.waitForNonExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Choose Trip"].exists)
        app.buttons["Remove search filter"].tap()
        XCTAssertTrue(app.scrollViews["active-filters"].waitForNonExistence(timeout: 5))
        capture(app, "Clear removes the bubble without leaving an empty row")
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.staticTexts["Plan your next trip"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Switch trip"].exists)
    }
    @MainActor private func expectLabel(_ text: String, element: XCUIElement) {
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", text), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ title: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = title
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

extension XCTestCase {
    /// All Add Stop entrances now converge on the Map dropdown and the explicit popup action.
    @MainActor func addSearchedStop(
        _ query: String, app: XCUIApplication, place: Bool = false,
        returnToPlanner: Bool = true
    ) {
        let search = app.textFields["park-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        XCTAssertTrue(app.tabBars.buttons["Map"].isSelected)
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 5), "Add Stop focuses Map search automatically"
        )
        if app.buttons["Clear search"].exists { app.buttons["Clear search"].tap() }
        search.tap()
        search.typeText(query)
        let prefix = place ? "place-result-" : "park-result-"
        let result = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", prefix)).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        let add = app.buttons["add-to-route-day"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.buttons["park-trip-membership"].waitForExistence(timeout: 5))
        if returnToPlanner { app.tabBars.buttons["Trips"].tap() }
    }
}
