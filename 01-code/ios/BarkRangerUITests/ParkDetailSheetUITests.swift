import XCTest

nonisolated final class ParkDetailSheetUITests: XCTestCase {
    @MainActor
    func testThreeDetentsKeepSelectionVisibleAndRestoreDiscovery() {
        let app = openPark()
        let search = app.textFields["park-search"]
        let sheet = app.scrollViews["park-detail-sheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].isHittable)
        XCTAssertTrue(app.buttons["Park Info"].isHittable)
        XCTAssertFalse(app.staticTexts["Park photos coming soon"].exists)
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(app.tabBars.buttons["Map"].isHittable)
        XCTAssertLessThan(app.staticTexts["park-detail-name"].frame.height, 30)
        assertVisiblePin(app)
        capture("Low — name and real actions", app)

        let lowTop = app.otherElements["park-sheet-handle"].frame.midY
        dragHandle(app, by: -220)
        XCTAssertTrue(app.staticTexts["Park photos coming soon"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["Updates and information"].exists)
        assertVisiblePin(app)
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(app.tabBars.buttons["Map"].isHittable)
        capture("Medium — metadata, actions and neutral thumbnails", app)

        let mediumTop = app.otherElements["park-sheet-handle"].frame.midY
        dragHandle(app, by: -app.frame.height * 0.6)
        XCTAssertTrue(app.staticTexts["Updates and information"].waitForExistence(timeout: 3))
        XCTAssertFalse(search.isHittable)
        XCTAssertFalse(app.tabBars.buttons["Map"].isHittable)
        capture("High — full scrollable details", app)
        let highTop = app.otherElements["park-sheet-handle"].frame.midY
        sheet.swipeUp()
        XCTAssertTrue(app.staticTexts["Updates and information"].exists)
        dragHandle(app, by: mediumTop - highTop)
        XCTAssertFalse(app.staticTexts["Updates and information"].exists)
        XCTAssertTrue(app.staticTexts["Park photos coming soon"].exists)
        dragHandle(app, by: lowTop - mediumTop)
        XCTAssertFalse(app.staticTexts["Park photos coming soon"].exists)
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].isHittable)
        app.buttons["Park Info"].tap()
        XCTAssertTrue(app.staticTexts["Updates and information"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.tabBars.buttons["Map"].isHittable)
        app.buttons["Close park details"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        XCTAssertEqual(search.value as? String, "hulls cove")
        XCTAssertEqual(app.staticTexts["park-count"].label, "1 of 393 parks")
        XCTAssertTrue(app.buttons["Remove search filter"].exists)
        search.tap()
        XCTAssertTrue(app.scrollViews["park-results"].exists)
    }

    @MainActor
    func testDarkLandscapeKeepsFullDetailsReachable() {
        let appearance = XCUIDevice.shared.appearance
        XCUIDevice.shared.appearance = .dark
        defer {
            XCUIDevice.shared.orientation = .portrait
            XCUIDevice.shared.appearance = appearance
        }
        let app = openPark()
        app.buttons["Park Info"].tap()
        capture("Dark full details", app)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["Close park details"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.tabBars.buttons["Map"].isHittable)
        let sheet = app.scrollViews["park-detail-sheet"]
        let website = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Source website")).firstMatch
        for _ in 0..<10 where !website.isHittable { sheet.swipeUp(velocity: .fast) }
        XCTAssertTrue(website.isHittable)
        XCTAssertTrue(app.buttons["Close park details"].isHittable)
        capture("Landscape — source links and close remain reachable", app)
        app.buttons["Close park details"].tap()
        XCTAssertTrue(app.textFields["park-search"].exists)
    }

    @MainActor
    private func openPark() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        app.tabBars.buttons["Map"].tap()
        let search = app.textFields["park-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("hulls cove")
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-result-"))
            .firstMatch.tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForExistence(timeout: 5))
        return app
    }

    @MainActor
    private func dragHandle(_ app: XCUIApplication, by delta: CGFloat) {
        let top = app.otherElements["park-sheet-handle"].frame.midY
        let start = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX, dy: top))
        let end = start.withOffset(
            CGVector(dx: 0, dy: max(15, min(app.frame.height - 15, top + delta)) - top))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
    }

    @MainActor
    private func assertVisiblePin(_ app: XCUIApplication) {
        let pin = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-pin-"))
            .firstMatch
        XCTAssertTrue(pin.waitForExistence(timeout: 3))
        XCTAssertTrue(pin.isHittable)
        XCTAssertLessThan(pin.frame.maxY, app.buttons["Close park details"].frame.minY - 18)
    }

    @MainActor
    private func capture(_ name: String, _ app: XCUIApplication) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
