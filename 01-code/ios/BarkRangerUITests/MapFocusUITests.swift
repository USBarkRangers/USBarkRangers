import XCTest

nonisolated final class MapFocusUITests: XCTestCase {
    @MainActor func testGapDismissesKeyboardAndReturningToMapDoesNotReplayAddStop() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        app.buttons["route-day-title"].tap()
        app.buttons["Add Stop"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let search = app.textFields["park-search"]
        search.typeText("zion")
        let rail = app.scrollViews["active-filters"]
        XCTAssertTrue(rail.waitForExistence(timeout: 5))
        let count = app.staticTexts["park-count"].label
        rail.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertEqual(search.value as? String, "zion")
        XCTAssertEqual(app.staticTexts["park-count"].label, count)
        for tab in ["Trips", "Home", "Passport"] {
            app.tabBars.buttons[tab].tap()
            app.tabBars.buttons["Map"].tap()
            XCTAssertTrue(search.waitForExistence(timeout: 5))
            XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 1))
            XCTAssertEqual(search.value as? String, "zion")
        }
        // A genuinely new Add Stop intent still focuses search; clearing a chip doesn't tap the gap.
        app.tabBars.buttons["Trips"].tap()
        app.buttons["route-day-title"].tap()
        app.buttons["Add Stop"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["Remove search filter"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.exists)
    }
}
