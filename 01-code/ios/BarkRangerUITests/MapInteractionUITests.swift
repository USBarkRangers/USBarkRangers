import XCTest

nonisolated final class MapInteractionUITests: XCTestCase {
    @MainActor
    func testGroupingPreferenceChangesNativeClustersInTheSameSession() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        app.tabBars.buttons["Map"].tap()
        let clusters = app.buttons.matching(identifier: "park-cluster")
        XCTAssertTrue(clusters.firstMatch.waitForExistence(timeout: 5))
        for grouped in [false, true, false, true] {
            app.tabBars.buttons["Home"].tap()
            app.buttons["Settings"].tap()
            let toggle = app.switches["Group nearby pins"]
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            XCTAssertEqual(toggle.value as? String, grouped ? "1" : "0")
            app.buttons["Done"].tap()
            app.tabBars.buttons["Map"].tap()
            if grouped {
                XCTAssertTrue(clusters.firstMatch.waitForExistence(timeout: 5))
            } else {
                XCTAssertTrue(clusters.firstMatch.waitForNonExistence(timeout: 5))
                XCTAssertTrue(
                    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "park-pin-"))
                        .firstMatch.exists)
            }
            XCTAssertEqual(app.staticTexts["park-count"].label, "393 of 393 parks")
        }
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("Indiana Dunes")
        let id = "6e813bbd-50b1-45e7-8bfa-9a64f1104595"
        app.buttons["park-result-\(id)"].tap()
        let selected = app.buttons["park-pin-\(id)"]
        XCTAssertTrue(selected.isSelected)
        XCTAssertTrue(selected.isHittable, "A selected park must not remain hidden in a cluster")
        for grouped in [false, true] {
            app.tabBars.buttons["Home"].tap()
            app.buttons["Settings"].tap()
            let toggle = app.switches["Group nearby pins"]
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
            XCTAssertEqual(toggle.value as? String, grouped ? "1" : "0")
            app.buttons["Done"].tap()
            app.tabBars.buttons["Map"].tap()
            XCTAssertTrue(selected.isSelected)
            XCTAssertTrue(selected.isHittable)
            XCTAssertTrue(app.staticTexts["Indiana Dunes National Park Visitor Center"].exists)
            XCTAssertEqual(app.staticTexts["park-count"].label, "2 of 393 parks")
        }
    }

    @MainActor
    func testPinToPinSelectionKeepsZoomAndShowsTheLatestPark() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchEnvironment["BARK_CATALOG_URL"] = ""
        app.launch()
        app.buttons["Settings"].tap()
        let toggle = app.switches["Group nearby pins"]
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertEqual(toggle.value as? String, "0")
        app.buttons["Done"].tap()
        app.tabBars.buttons["Map"].tap()
        let search = app.textFields["park-search"]
        search.tap()
        search.typeText("Minna")
        let firstID = "1d53e802-6f18-41a6-898b-dbb10bb813f2"
        let secondID = "80b3e5dd-368e-4e1e-aa90-eb3930a16569"
        let result = app.buttons["park-result-\(firstID)"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        result.tap()
        // Focus this nearby pair, then broaden the query without changing the camera.
        app.buttons["Close park details"].tap()
        app.maps.firstMatch.pinch(withScale: 1.5, velocity: 1)
        search.tap()
        app.buttons["Clear search"].tap()
        search.typeText("New York")
        // The dropdown is wide: use the exposed map edge, not a result row underneath it.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.99, dy: 0.45)).tap()
        XCTAssertTrue(app.scrollViews["park-results"].waitForNonExistence(timeout: 3))
        let firstPin = app.buttons["park-pin-\(firstID)"]
        let secondPin = app.buttons["park-pin-\(secondID)"]
        XCTAssertTrue(secondPin.waitForExistence(timeout: 5))
        firstPin.tap()
        waitForPinToSettle(firstPin, in: app)
        let count = app.staticTexts["park-count"].label
        let separation = CGVector(
            dx: secondPin.frame.midX - firstPin.frame.midX, dy: secondPin.frame.midY - firstPin.frame.midY)
        for (pin, other, name) in [
            (secondPin, firstPin, "Wellesley Island State Park"),
            (firstPin, secondPin, "Minna Anthony Common Nature Center"),
        ] {
            pin.tap()
            waitForPinToSettle(pin, in: app)
            XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 3))
            XCTAssertTrue(pin.isSelected)
            XCTAssertFalse(other.isSelected)
            XCTAssertEqual(secondPin.frame.midX - firstPin.frame.midX, separation.dx, accuracy: 3)
            XCTAssertEqual(secondPin.frame.midY - firstPin.frame.midY, separation.dy, accuracy: 3)
            XCTAssertLessThan(pin.frame.maxY, app.scrollViews["park-detail-sheet"].frame.minY)
            XCTAssertEqual(app.staticTexts["park-count"].label, count)
            capture("Pin selection: \(name)", app)
        }
        let handle = app.otherElements["park-sheet-handle"]
        let anchorY = firstPin.frame.midY
        for (delta, pin, detent) in [(-220.0, secondPin, "Medium"), (220.0, firstPin, "Low")] {
            let start = app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: app.frame.midX, dy: handle.frame.midY))
            start.press(
                forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)),
                withVelocity: .slow, thenHoldForDuration: 0.3)
            XCTAssertEqual(handle.value as? String, detent)
            waitForPinToSettle(detent == "Medium" ? firstPin : secondPin, in: app)
            let priorPin = detent == "Medium" ? firstPin : secondPin
            XCTAssertEqual(
                priorPin.frame.midY, anchorY, accuracy: 3, "Changing low/medium must not pan the map")
            XCTAssertTrue(pin.isHittable)
            pin.tap()
            waitForPinToSettle(pin, in: app)
            XCTAssertTrue(pin.isSelected)
            XCTAssertEqual(handle.value as? String, detent, "The next park keeps the chosen sheet height")
            let gap = handle.frame.minY - pin.frame.maxY
            XCTAssertGreaterThan(gap, 10)
            XCTAssertEqual(pin.frame.midY, anchorY, accuracy: 3)
            if detent == "Medium" { XCTAssertLessThan(gap, 65) }
            capture("Next park stays \(detent)", app)
        }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.45)).tap()
        XCTAssertTrue(app.scrollViews["park-detail-sheet"].waitForNonExistence(timeout: 3))
        XCTAssertFalse(firstPin.isSelected)
        XCTAssertEqual(search.value as? String, "New York")
    }

    @MainActor
    func testMapTouchesCollapseAndRestoreSearchWithoutClearingItsResults() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
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
    private func waitForPinToSettle(_ pin: XCUIElement, in app: XCUIApplication) {
        // Native map animations do not always keep XCTest's application-idle tracker busy.
        // Wait for the selected badge's observed position instead of tapping its old coordinates.
        var previous = CGRect.null
        var stableSince = Date()
        let settled = NSPredicate { _, _ in
            MainActor.assumeIsolated {
                let frame = pin.frame
                if frame != previous || !pin.isSelected {
                    previous = frame
                    stableSince = Date()
                }
                return pin.isSelected && abs(frame.midX - app.frame.midX) < 2
                    && Date().timeIntervalSince(stableSince) > 0.4
            }
        }
        XCTAssertEqual(
            XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: pin)], timeout: 5),
            .completed, "Selected pin did not settle at the visible map's horizontal center")
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
