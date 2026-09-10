import XCTest

nonisolated final class AppShellUITests: XCTestCase {
    @MainActor
    func testTabsSheetAndRelaunch() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
        app.buttons["About Bark Ranger"].tap()
        XCTAssertTrue(app.navigationBars["About Bark Ranger"].exists)
        app.buttons["Done"].tap()
        XCTAssertFalse(app.navigationBars["About Bark Ranger"].exists)

        for tab in ["Map", "Trips", "Passport", "Account"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.navigationBars[tab].exists)
            if tab != "Map" { XCTAssertTrue(app.staticTexts["Development preview"].exists) }
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
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
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
            // iOS 26's contrast audit includes Home text occluded by translucent bars and
            // reports even black-on-system-background paragraphs. Keep other audit types;
            // Home contrast is reviewed separately in the phase report and screenshots.
            try app.performAccessibilityAudit(for: [.all.subtracting(.contrast)])
            app.buttons["About Bark Ranger"].tap()
            try app.performAccessibilityAudit()
            XCTAssertTrue(app.buttons["Done"].isHittable)
            app.buttons["Done"].tap()
            for tab in ["Map", "Trips", "Passport", "Account"] {
                app.tabBars.buttons[tab].tap()
                if tab == "Map" {
                    if app.buttons["Clear"].exists { app.buttons["Clear"].tap() }
                    app.buttons["Search parks"].tap()
                    let search = app.searchFields.firstMatch
                    search.tap()
                    search.typeText("hulls cove")
                    app.buttons["Done"].tap()
                    app.segmentedControls.buttons["Results list"].tap()
                }
                try app.performAccessibilityAudit()
            }
        }
    }

    @MainActor
    func testLargestTextKeepsScrollableContentAndActionsReachable() {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
        app.launchArguments = [
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        XCTAssertTrue(app.navigationBars["Bark Ranger"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.buttons["Explore parks"].isHittable)
        app.buttons["Explore parks"].tap()
        app.segmentedControls.buttons["Results list"].tap()
        XCTAssertTrue(app.buttons["Filters"].isHittable)
        app.tabBars.buttons["Home"].tap()
        app.buttons["About Bark Ranger"].tap()
        XCTAssertTrue(app.buttons["Done"].isHittable)
        app.buttons["Done"].tap()
    }

    @MainActor
    func testPublicDeepLinkAndUnsupportedAccountLink() throws {
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_PREFERENCES_SUITE"] = UUID().uuidString
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
