import XCTest

nonisolated final class AppShellUITests: XCTestCase {
    @MainActor
    func testTabsSheetAndRelaunch() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
        app.buttons["About Bark Ranger"].tap()
        XCTAssertTrue(app.navigationBars["About Bark Ranger"].exists)
        app.buttons["Done"].tap()
        XCTAssertFalse(app.navigationBars["About Bark Ranger"].exists)

        for tab in ["Map", "Trips", "Passport", "Account"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.navigationBars[tab].exists)
            XCTAssertTrue(app.staticTexts["Development preview"].exists)
        }
        app.buttons["Back to Home"].tap()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].exists)
        app.buttons["Explore parks"].tap()
        XCTAssertTrue(app.navigationBars["Map"].exists)

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.navigationBars["Map"].waitForExistence(timeout: 5))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testAccessibilityInBothAppearances() throws {
        let app = XCUIApplication()
        let originalAppearance = XCUIDevice.shared.appearance
        defer { XCUIDevice.shared.appearance = originalAppearance }
        for appearance in [XCUIDevice.Appearance.light, .dark] {
            app.launch()
            XCUIDevice.shared.appearance = appearance
            XCTAssertEqual(XCUIDevice.shared.appearance, appearance)
            XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "Home appearance \(appearance.rawValue)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            // Bring the lower card clear of the translucent tab bar on small phones.
            app.swipeUp()
            try app.performAccessibilityAudit()
            app.buttons["About Bark Ranger"].tap()
            try app.performAccessibilityAudit()
            XCTAssertTrue(app.buttons["Done"].isHittable)
            app.buttons["Done"].tap()
            for tab in ["Map", "Trips", "Passport", "Account"] {
                app.tabBars.buttons[tab].tap()
                try app.performAccessibilityAudit()
            }
        }
    }

    @MainActor
    func testLargestTextKeepsScrollableContentAndActionsReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.buttons["Explore parks"].isHittable)
        app.buttons["Explore parks"].tap()
        app.swipeUp()
        XCTAssertTrue(app.buttons["Back to Home"].isHittable)
        app.buttons["Back to Home"].tap()
        app.buttons["About Bark Ranger"].tap()
        XCTAssertTrue(app.buttons["Done"].isHittable)
        app.buttons["Done"].tap()
    }

    @MainActor
    func testPublicDeepLinkAndUnsupportedAccountLink() throws {
        let app = XCUIApplication()
        app.launch()
        app.tabBars.buttons["Trips"].tap()
        XCUIDevice.shared.system.open(try XCTUnwrap(URL(string: "barkranger://account")))
        XCTAssertTrue(app.navigationBars["Trips"].waitForExistence(timeout: 5))
        app.open(try XCTUnwrap(URL(string: "barkranger://about")))
        XCTAssertTrue(app.navigationBars["About Bark Ranger"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.open(try XCTUnwrap(URL(string: "barkranger://home")))
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
    }
}
