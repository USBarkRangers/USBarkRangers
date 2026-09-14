import XCTest

nonisolated final class ItineraryScrollUITests: XCTestCase {
    @MainActor func testMapDayPopupKeepsLongRowsStableDuringFastScrollingAndExpansion() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        for query in [
            "zion", "cuyahoga", "grand canyon", "yellowstone", "acadia", "nahant", "indiana dunes",
            "jester", "mahaska", "pipestone", "pilot mountain",
        ] {
            app.buttons["route-day-title"].tap()
            app.buttons["Add Stop"].tap()
            addSearchedStop(query, app: app)
        }
        app.tabBars.buttons["Map"].tap()
        let handle = app.otherElements["route-day-handle"]
        if !handle.exists {
            app.buttons["park-trip-membership"].tap()
            app.buttons["Edit Day 1"].tap()
        }
        let table = app.tables["route-stop-list"]
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        for _ in 0..<2 where handle.value as? String != "High" { handle.tap() }
        XCTAssertEqual(handle.value as? String, "High")
        scrollToEnd(table, app: app, surface: "Map high")
        for _ in 0..<12 where !visible(stop("Zion", app: app), in: table, app: app) {
            table.swipeDown(velocity: .fast)
        }
        XCTAssertTrue(visible(stop("Zion", app: app), in: table, app: app))
        handle.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
            forDuration: 0.05,
            thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65)),
            withVelocity: .slow, thenHoldForDuration: 0.1)
        XCTAssertNotEqual(handle.value as? String, "High")
        for _ in 0..<2 where handle.value as? String != "High" { handle.tap() }
        XCTAssertTrue(visible(stop("Zion", app: app), in: table, app: app))
        capture(app, "Map — collapsed and reopened at first stop")
        app.buttons["Close day"].tap()
        app.tabBars.buttons["Trips"].tap()
        XCTAssertTrue(app.staticTexts["11 stops"].exists)
        app.segmentedControls.buttons["Overview"].tap()
        app.segmentedControls.buttons["Planner"].tap()
        XCTAssertTrue(app.staticTexts["11 stops"].exists)
    }

    @MainActor private func stop(_ name: String, app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH[c] %@", "Options for " + name)
        ).firstMatch
    }
    @MainActor private func scrollToEnd(_ table: XCUIElement, app: XCUIApplication, surface: String) {
        // Hosted controls can report hittable outside the clipped sheet. Check actual screen bounds too.
        for _ in 0..<14 where !visible(stop("Pilot Mountain", app: app), in: table, app: app) {
            table.swipeUp(velocity: .fast)
        }
        XCTAssertTrue(
            visible(stop("Pilot Mountain", app: app), in: table, app: app),
            "Final stop reachable in \(surface)")
        let visible = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH 'route-stop-'"))
            .allElementsBoundByIndex.filter(\.isHittable).map(\.frame)
        XCTAssertTrue(zip(visible, visible.dropFirst()).allSatisfy { $0.maxY <= $1.minY + 1 })
        // Fling into the lower boundary repeatedly. The last row must settle in the same place;
        // discovering offscreen cells must not grow the document or move this boundary.
        table.swipeUp(velocity: .fast)
        let finalY = stop("Pilot Mountain", app: app).frame.midY
        for _ in 0..<3 { table.swipeUp(velocity: .fast) }
        XCTAssertEqual(stop("Pilot Mountain", app: app).frame.midY, finalY, accuracy: 1)
        capture(app, "\(surface) — final stops after scrolling")
    }
    @MainActor private func visible(_ element: XCUIElement, in table: XCUIElement, app: XCUIApplication)
        -> Bool
    {
        element.exists && element.isHittable
            && table.frame.intersection(app.frame).insetBy(dx: 0, dy: 12).contains(element.frame)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ title: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = title
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
