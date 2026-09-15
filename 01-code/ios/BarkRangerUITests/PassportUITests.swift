import XCTest

// Current guest/visual checks. Retired web-account workflows are covered by the native UI suites.
nonisolated final class PassportUITests: XCTestCase {
    @MainActor func testLocalWatermarkDefaultsAndSnapsToFourCorners() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BARK_TEST_SCOPE"] = UUID().uuidString
        app.launchArguments += ["-AppleInterfaceStyle", "Dark"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Passport"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Passport"].tap()
        let watermark = app.buttons["passport-watermark"]
        for _ in 0..<4 where !watermark.isHittable { app.swipeUp() }
        watermark.tap()
        XCTAssertTrue(app.navigationBars["Photo watermark"].waitForExistence(timeout: 5))
        app.buttons["Choose photo"].tap()
        let photo = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 5), "Seed a synthetic photo with simctl addmedia first")
        // Photos exposes grid images without an accessibility hit point on iOS 26.
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let logo = app.images["watermark-logo"]
        XCTAssertTrue(logo.waitForExistence(timeout: 10))
        XCTAssertEqual(logo.value as? String, "Bottom right")
        let preview = app.descendants(matching: .any)["watermark-preview"]
        let frame = preview.frame
        for (point, corner) in [
            (CGVector(dx: 0.2, dy: 0.2), "Top left"),
            (CGVector(dx: 0.8, dy: 0.2), "Top right"),
            (CGVector(dx: 0.2, dy: 0.8), "Bottom left"),
            (CGVector(dx: 0.8, dy: 0.8), "Bottom right"),
        ] {
            let target = app.coordinate(withNormalizedOffset: .zero).withOffset(
                CGVector(dx: frame.minX + frame.width * point.dx, dy: frame.minY + frame.height * point.dy))
            logo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.15, thenDragTo: target)
            let landed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", corner), object: logo)
            XCTAssertEqual(XCTWaiter.wait(for: [landed], timeout: 3), .completed)
            let bounds = logo.frame
            XCTAssertEqual(
                corner.contains("left") ? bounds.minX - frame.minX : frame.maxX - bounds.maxX,
                frame.width * 0.02, accuracy: 2)
            XCTAssertEqual(
                corner.contains("Top") ? bounds.minY - frame.minY : frame.maxY - bounds.maxY,
                frame.width * 0.02, accuracy: 2)
            capture(app, "Watermark snapped to \(corner)")
        }
        app.sliders["watermark-size"].adjust(toNormalizedSliderPosition: 0.9)
        XCTAssertEqual(logo.value as? String, "Bottom right")
        XCTAssertEqual(frame.maxX - logo.frame.maxX, frame.width * 0.02, accuracy: 2)
        XCTAssertEqual(frame.maxY - logo.frame.maxY, frame.width * 0.02, accuracy: 2)
        app.buttons["Share photo"].tap()
        XCTAssertTrue(app.otherElements["ShareSheet.RemoteContainerView"].waitForExistence(timeout: 10))
        // CI run 34942547676 shows the remote container before Apple's share
        // activities have loaded. Wait for the required content, not just its shell.
        let save = app.cells.matching(NSPredicate(format: "label == 'Save to Files'")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 10))
        let jpeg = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "JPEG Image"),
            object: app.otherElements["LP.CaptionBar.BottomCaption"])
        XCTAssertEqual(XCTWaiter.wait(for: [jpeg], timeout: 10), .completed)
        capture(app, "Corner watermark ready in native share sheet")
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

}
