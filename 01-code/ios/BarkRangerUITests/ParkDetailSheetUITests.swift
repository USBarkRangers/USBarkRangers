import XCTest

nonisolated final class ParkDetailSheetUITests: XCTestCase {
    @MainActor
    func testBodyDragsResizeBeforeHighContentCanScrollAndTabsRecover() {
        let app = openPark()
        let name = app.staticTexts["park-detail-name"]
        let handle = app.otherElements["park-sheet-handle"]
        for (detent, distance) in [("Medium", 220.0), ("High", 360.0)] {
            let start = app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: 32, dy: name.frame.midY))
            start.press(
                forDuration: 0.1,
                thenDragTo: start.withOffset(CGVector(dx: 0, dy: -min(distance, name.frame.midY - 20))),
                withVelocity: .slow, thenHoldForDuration: 2)
            XCTAssertEqual(handle.value as? String, detent)
            XCTAssertGreaterThanOrEqual(name.frame.minY, handle.frame.maxY)
            XCTAssertLessThan(
                name.frame.minY - handle.frame.maxY, 12, "Resizing must leave content at its top")
            capture("Body drag to \(detent) keeps content at top", app)
        }
        let collapse = app.coordinate(withNormalizedOffset: .zero).withOffset(
            CGVector(dx: 32, dy: name.frame.midY))
        collapse.press(
            forDuration: 0.1,
            thenDragTo: collapse.withOffset(CGVector(dx: 0, dy: 220)),
            withVelocity: .slow, thenHoldForDuration: 0.3)
        XCTAssertEqual(handle.value as? String, "Medium", "A downward body drag at the top can collapse high")
        app.buttons["Park Info"].tap()
        XCTAssertTrue(app.staticTexts["Updates and information"].waitForExistence(timeout: 3))
        let sheet = app.scrollViews["park-detail-sheet"]
        let titleY = name.frame.minY
        sheet.swipeUp()
        XCTAssertEqual(handle.value as? String, "High")
        XCTAssertTrue(!name.isHittable || name.frame.minY < titleY - 20, "High content must scroll normally")
        app.buttons["Close park details"].tap()
        XCTAssertTrue(app.tabBars.buttons["Home"].isHittable)
        app.tabBars.buttons["Home"].tap()
        XCTAssertTrue(app.buttons["Settings"].isHittable)
        app.tabBars.buttons["Map"].tap()
        XCTAssertTrue(app.textFields["park-search"].isHittable)
        XCTAssertTrue(app.tabBars.buttons["Home"].isHittable)
    }

    @MainActor
    func testShortLiftPastMediumRestoresChromeWhenReleasedBackToMedium() {
        let app = openPark()
        dragHandle(app, by: -220)
        let home = app.tabBars.buttons["Home"]
        let resting = home.frame
        // Hold just beyond the threshold. The recording must show both controls finish leaving
        // before release; the native layer regression also verifies this without further input.
        dragHandle(app, by: -40, hold: 2)
        XCTAssertEqual(app.otherElements["park-sheet-handle"].value as? String, "Medium")
        XCTAssertTrue(home.isHittable)
        XCTAssertTrue(app.textFields["park-search"].isHittable)
        XCTAssertEqual(home.frame.minY, resting.minY, accuracy: 2)
        capture("Short lift reverses cleanly back to medium", app)
    }

    @MainActor
    func testScrolledHighSheetReturnsTabsToTheirRestingPositionRepeatedly() {
        let app = openPark()
        let home = app.tabBars.buttons["Home"]
        let resting = home.frame
        dragHandle(app, by: -220)
        let mediumTop = app.otherElements["park-sheet-handle"].frame.midY
        let pin = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-pin-"))
            .firstMatch
        let anchor = pin.frame
        for cycle in 0..<3 {
            app.buttons["Park Info"].tap()
            XCTAssertTrue(app.staticTexts["Updates and information"].waitForExistence(timeout: 3))
            app.scrollViews["park-detail-sheet"].swipeUp()
            let highTop = app.otherElements["park-sheet-handle"].frame.midY
            dragHandle(app, by: mediumTop - highTop)
            XCTAssertEqual(app.otherElements["park-sheet-handle"].value as? String, "Medium")
            XCTAssertTrue(home.isHittable)
            XCTAssertEqual(
                home.frame.minY, resting.minY, accuracy: 2, "Cycle \(cycle) must restore the baseline")
            XCTAssertEqual(home.frame.height, resting.height, accuracy: 2)
            XCTAssertEqual(pin.frame.midX, anchor.midX, accuracy: 1)
            XCTAssertEqual(pin.frame.midY, anchor.midY, accuracy: 1, "Returning from high must never pan")
        }
        capture("Tabs stay at their resting height after repeated high scrolling", app)
        app.buttons["Close park details"].tap()
        XCTAssertEqual(home.frame.minY, resting.minY, accuracy: 2)
        home.tap()
        XCTAssertTrue(app.buttons["Settings"].isHittable)
    }

    @MainActor
    func testThreeDetentsKeepSelectionVisibleAndRestoreDiscovery() {
        let app = openPark()
        let search = app.textFields["park-search"]
        let sheet = app.scrollViews["park-detail-sheet"]
        let searchTop = app.otherElements["park-search-bar"].frame.minY
        XCTAssertTrue(sheet.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Directions in Apple Maps"].isHittable)
        XCTAssertTrue(app.buttons["Park Info"].isHittable)
        XCTAssertFalse(app.staticTexts["Park photos coming soon"].exists)
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(app.tabBars.buttons["Map"].isHittable)
        XCTAssertLessThan(app.staticTexts["park-detail-name"].frame.height, 30)
        XCTAssertLessThan(app.frame.maxY - app.otherElements["park-sheet-handle"].frame.minY, 280)
        assertVisiblePin(app)
        capture("Low — name and real actions", app)

        let lowTop = app.otherElements["park-sheet-handle"].frame.midY
        dragHandle(app, by: -220)
        XCTAssertTrue(app.staticTexts["Park photos coming soon"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["park-swag-cost"].exists)
        XCTAssertFalse(app.staticTexts["Updates and information"].exists)
        assertVisiblePin(app)
        XCTAssertTrue(search.isHittable)
        XCTAssertTrue(app.tabBars.buttons["Map"].isHittable)
        capture("Medium — metadata, actions and neutral thumbnails", app)

        let mediumTop = app.otherElements["park-sheet-handle"].frame.midY
        dragHandle(app, by: -app.frame.height * 0.6, hold: 2)
        XCTAssertTrue(app.staticTexts["Updates and information"].waitForExistence(timeout: 3))
        XCTAssertFalse(search.isHittable)
        XCTAssertFalse(app.tabBars.buttons["Map"].isHittable)
        XCTAssertEqual(app.otherElements["park-sheet-handle"].frame.minY, searchTop, accuracy: 4)
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
    func testExposedMapDismissesHighSheetAndDeselectsPin() {
        let app = openPark()
        let pin = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-pin-"))
            .firstMatch
        XCTAssertTrue(pin.isSelected)
        app.buttons["Park Info"].tap()
        let handle = app.otherElements["park-sheet-handle"]
        XCTAssertTrue(app.staticTexts["Updates and information"].waitForExistence(timeout: 3))
        app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: 16, dy: handle.frame.minY - 4)).tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForNonExistence(timeout: 3))
        XCTAssertFalse(pin.isSelected)
        XCTAssertTrue(app.tabBars.buttons["Map"].isHittable)
        XCTAssertEqual(app.textFields["park-search"].value as? String, "hulls cove")
        pin.tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForExistence(timeout: 3))
        XCTAssertTrue(pin.isSelected)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.4)).tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForNonExistence(timeout: 3))
        XCTAssertFalse(pin.isSelected)
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
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
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
    private func dragHandle(_ app: XCUIApplication, by delta: CGFloat, hold: TimeInterval = 0.3) {
        let top = app.otherElements["park-sheet-handle"].frame.midY
        let start = app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: app.frame.midX, dy: top))
        let end = start.withOffset(
            CGVector(dx: 0, dy: max(15, min(app.frame.height - 15, top + delta)) - top))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: hold)
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
