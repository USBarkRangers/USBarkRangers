import XCTest

nonisolated final class StopReorderUITests: XCTestCase {
    @MainActor func testNativeDropStaysOrderedAcrossPlannerAndMap() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Trips"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Trips"].tap()
        app.buttons["New trip"].tap()
        for query in ["zion", "cuyahoga"] {
            app.buttons["route-day-title"].tap()
            app.buttons["Add Stop"].tap()
            addSearchedStop(query, app: app)
        }
        let rows = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "route-stop-"))
        XCTAssertEqual(rows.count, 2)
        guard rows.count == 2 else { return }
        let original = rows.allElementsBoundByIndex.map(\.identifier)
        reorder(rows, expected: Array(original.reversed()))

        app.tabBars.buttons["Map"].tap()
        let handle = app.otherElements["route-day-handle"]
        if !handle.exists {
            let membership = app.buttons["park-trip-membership"]
            XCTAssertTrue(membership.waitForExistence(timeout: 5))
            membership.tap()
            app.buttons["Edit Day 1"].tap()
        }
        XCTAssertTrue(handle.waitForExistence(timeout: 5))
        for _ in 0..<2 where handle.value as? String != "High" { handle.tap() }
        XCTAssertEqual(handle.value as? String, "High")
        XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), Array(original.reversed()))
        reorder(rows, expected: original)
        app.buttons["Close day"].tap()
        app.tabBars.buttons["Trips"].tap()
        XCTAssertEqual(rows.allElementsBoundByIndex.map(\.identifier), original)
    }

    @MainActor private func reorder(_ rows: XCUIElementQuery, expected: [String]) {
        rows.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.65)).press(
            forDuration: 0.6,
            thenDragTo: rows.element(boundBy: 1).coordinate(
                withNormalizedOffset: CGVector(dx: 0.35, dy: 0.98)),
            withVelocity: .slow, thenHoldForDuration: 0.3)
        let settled = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                MainActor.assumeIsolated { rows.allElementsBoundByIndex.map(\.identifier) == expected }
            }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 5), .completed)
        let frames = rows.allElementsBoundByIndex.map(\.frame)
        XCTAssertTrue(zip(frames, frames.dropFirst()).allSatisfy { $0.maxY <= $1.minY + 1 })
    }
}
