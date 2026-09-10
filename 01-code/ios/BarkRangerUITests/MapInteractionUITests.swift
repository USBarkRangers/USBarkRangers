import XCTest

nonisolated final class MapInteractionUITests: XCTestCase {
    @MainActor
    func testMapTouchesCollapseAndRestoreSearchWithoutClearingItsResults() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        app.tabBars.buttons["Map"].tap()
        let cluster = app.buttons.matching(identifier: "park-cluster").firstMatch
        XCTAssertTrue(cluster.waitForExistence(timeout: 5))
        capture("Branded map clusters", app)
        cluster.tap()
        XCTAssertFalse(app.scrollViews["park-detail-sheet"].exists)
        XCTAssertEqual(app.staticTexts["park-count"].label, "393 of 393 parks")
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("hulls cove")
        let results = app.scrollViews["park-results"]
        XCTAssertTrue(results.waitForExistence(timeout: 3))
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-")).firstMatch.tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForExistence(timeout: 3))
        app.buttons["Close park details"].tap()
        search.tap()
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.52)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        XCTAssertFalse(results.exists)
        assertSearchPreserved(app, text: "hulls cove", count: 1)
        capture("Search collapsed over branded pin", app)
        let pin = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-pin-"))
            .firstMatch
        XCTAssertTrue(pin.waitForExistence(timeout: 3))
        pin.tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForExistence(timeout: 3))
        app.buttons["Close park details"].tap()
        search.tap()
        XCTAssertTrue(results.waitForExistence(timeout: 2))
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let pinX = pin.frame.midX
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.52))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.62)))
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        XCTAssertFalse(results.exists)
        assertSearchPreserved(app, text: "hulls cove", count: 1)
        XCTAssertGreaterThan(abs(pin.frame.midX - pinX), 5)
        search.tap()
        XCTAssertTrue(results.waitForExistence(timeout: 2))
        search.typeText("zzzzzz")
        XCTAssertTrue(app.staticTexts["No matching parks"].exists)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.52)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 3))
        XCTAssertFalse(results.exists)
        assertSearchPreserved(app, text: "hulls covezzzzzz", count: 0)
        search.tap()
        XCTAssertTrue(app.staticTexts["No matching parks"].waitForExistence(timeout: 2))
    }

    @MainActor
    private func assertSearchPreserved(_ app: XCUIApplication, text: String, count: Int) {
        XCTAssertEqual(app.textFields["park-search"].value as? String, text)
        XCTAssertTrue(app.buttons["Remove search filter"].exists)
        XCTAssertEqual(app.staticTexts["park-count"].label, "\(count) of 393 parks")
        let map = app.descendants(matching: .any).matching(identifier: "park-map").firstMatch
        XCTAssertEqual(map.value as? String, "\(count) matching parks")
    }

    @MainActor
    private func capture(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
