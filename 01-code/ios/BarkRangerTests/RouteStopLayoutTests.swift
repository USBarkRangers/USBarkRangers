import BarkDomain
import SwiftUI
import Testing

@testable import BarkRanger

@MainActor struct RouteStopLayoutTests {
    private func stops() -> [Trip.Stop] {
        (0..<20).map {
            Trip.Stop(id: "stop-\($0)", placeIdentity: .custom("pin-\($0)"),
                name: "Park \($0)", coordinate: nil)
        }
    }
    private func content(
        _ stops: [Trip.Stop], scrolling: Bool = true, reset: Bool = false, ready: Bool = true,
        headingHeight: CGFloat = 30, day: String = "day"
    ) -> RouteStopList {
        RouteStopList(
            destination: .init(
                scope: "account", target: .init(tripID: "trip", dayID: day), stops: stops, enabled: true),
            scrolling: scrolling, bottomInset: 24, atTopChanged: { _ in }, dragChanged: { _ in },
            commit: { _ in },
            header: AnyView(Text("Day status").frame(height: headingHeight)), footer: AnyView(EmptyView()),
            contentReady: ready, resetsScroll: reset,
            row: { stop, number, _ in
                AnyView(
                    Text("\(number + 1). \(stop.name)")
                        .frame(height: CGFloat(70 + (Int(stop.id.dropFirst(5)) ?? 0) % 4 * 30)))
            })
    }

    @Test func cancelledAndNoOpDropsRestoreLegsWithoutWaitingForAStoreChange() throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let owner = fixture.owner
        let table = fixture.table
        _ = owner.drag.begin(at: 0)
        owner.drag.cancel()
        #expect(owner.displayedStops == rows && owner.pending == nil)
        _ = owner.drag.begin(at: 0)
        let source = try #require(owner.drag.source)
        let token = owner.drag.beginSettlement()
        _ = owner.movePreview(source, to: 0, on: table)
        owner.drag.end()
        owner.drag.animationFinished(token)
        #expect(!owner.drag.isSettling && owner.pending == nil)
        #expect(owner.displayedStops == rows)
        #expect(owner.showsDriveLegs, "A no-op drop has no future store update to restore leg visibility")
    }

    @Test func scrollingDoesNotChangeMeasuredRowPositionsOrContentHeight() async throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        try await Task.sleep(for: .milliseconds(100))
        table.layoutIfNeeded()
        let originalSize = table.contentSize.height
        let originalFrames = rows.indices.map { table.rectForRow(at: IndexPath(row: $0, section: 1)) }
        // Walk through previously unseen rows, then return. Ordinary scrolling must never change
        // the height of the document or its stop spacing as those rows enter the viewport.
        for offset in stride(from: CGFloat(300), through: originalSize, by: 300) {
            table.setContentOffset(
                CGPoint(x: 0, y: min(offset, table.contentSize.height - 500)), animated: false)
            table.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(20))
        }
        table.setContentOffset(.zero, animated: false)
        table.layoutIfNeeded()
        #expect(abs(table.contentSize.height - originalSize) < 1)
        let finalFrames = rows.indices.map { table.rectForRow(at: IndexPath(row: $0, section: 1)) }
        #expect(
            zip(originalFrames, finalFrames).allSatisfy {
                abs($0.minY - $1.minY) < 1 && abs($0.height - $1.height) < 1
            })
    }

    @Test(arguments: [-1.0, 0.0, 1.0, 24.0])
    func expandedViewportBoundaryKeepsEveryRowAtItsNaturalHeight(overflow: Double) async throws {
        let rows = Array(stops().prefix(3))
        let fixture = try Fixture(content(rows, scrolling: false, reset: true))
        defer { fixture.close() }
        let table = fixture.table
        let original = rows.indices.map { table.rectForRow(at: IndexPath(row: $0, section: 1)) }
        let height = table.contentSize.height
        table.frame.size.height = height + table.contentInset.bottom - overflow
        fixture.owner.update(content(rows), on: table)
        table.layoutIfNeeded()
        for _ in 0..<4 {
            table.setContentOffset(CGPoint(x: 0, y: max(0, overflow)), animated: false)
            table.layoutIfNeeded()
            table.setContentOffset(.zero, animated: false)
            table.layoutIfNeeded()
        }
        try await Task.sleep(for: .milliseconds(50))
        #expect(abs(table.contentSize.height - height) < 1)
        let final = rows.indices.map { table.rectForRow(at: IndexPath(row: $0, section: 1)) }
        #expect(
            zip(original, final).allSatisfy { abs($0.minY - $1.minY) < 1 && abs($0.height - $1.height) < 1 })
        #expect(table.contentOffset.y == 0)
    }

    @Test func unchangedPresentationAfterAFlickDoesNotCorrectTheOffset() throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        table.setContentOffset(CGPoint(x: 0, y: 650), animated: false)
        table.layoutIfNeeded()
        table.simulatedDeceleration = true
        fixture.owner.update(content(rows), on: table)
        table.resetCounts()
        table.simulatedDeceleration = false
        fixture.owner.scrollViewDidEndDecelerating(table)
        #expect(table.offsetWrites == 0)
        #expect(table.contentOffset.y == 650)
    }

    @Test func expandedContentUpdatesOffscreenHeightsBeforeTheNextSwipe() throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        let expanded = RouteStopList(
            destination: content(rows).destination, scrolling: true, bottomInset: 24,
            atTopChanged: { _ in }, dragChanged: { _ in }, commit: { _ in },
            header: AnyView(EmptyView()), footer: AnyView(EmptyView()),
            layoutKey: { .init(stop: $0, number: $1, detailed: false) },
            row: { stop, _, _ in AnyView(Text(stop.name).frame(height: 95)) })
        fixture.owner.update(expanded, on: table)
        table.layoutIfNeeded()
        for index in rows.indices {
            #expect(abs(table.rectForRow(at: IndexPath(row: index, section: 1)).height - 107) < 1)
        }
    }

    @Test func changingScrollPermissionDoesNotJumpButCommittedCollapseAndDayNavigationReset() async throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        let owner = fixture.owner
        table.setContentOffset(CGPoint(x: 0, y: 700), animated: false)
        table.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        table.layoutIfNeeded()
        let visible = try #require(table.indexPathsForVisibleRows?.sorted().first { $0.section == 1 })
        let relative = table.rectForRow(at: visible).minY - table.contentOffset.y
        owner.update(content(rows, scrolling: false), on: table)
        // Self-sizing rows can change absolute offsets; the visible stop must keep its screen position.
        #expect(abs(table.rectForRow(at: visible).minY - table.contentOffset.y - relative) < 1)
        owner.update(content(rows), on: table)
        #expect(abs(table.rectForRow(at: visible).minY - table.contentOffset.y - relative) < 1)
        owner.update(content(rows, scrolling: false, reset: true), on: table)
        #expect(table.contentOffset.y == 0)
        owner.update(content(rows), on: table)
        table.setContentOffset(CGPoint(x: 0, y: 700), animated: false)
        owner.update(content(rows, day: "another-day"), on: table)
        #expect(table.contentOffset.y == 0)
    }

    @Test func pendingRoutePlanCannotEraseDriveRowsAndStatusUpdatesKeepTheVisibleStopAnchored() async throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        let owner = fixture.owner
        table.setContentOffset(CGPoint(x: 0, y: 700), animated: false)
        table.layoutIfNeeded()
        let index = try #require(table.indexPathsForVisibleRows?.sorted().first { $0.section == 1 })
        let relative = table.rectForRow(at: index).minY - table.contentOffset.y
        var next = rows
        next.swapAt(13, 15)
        owner.update(content(next, ready: false, headingHeight: 0), on: table)
        #expect(owner.displayedStops == rows && owner.pending != nil)
        #expect(table.numberOfRows(inSection: 1) == rows.count)
        owner.update(content(next, headingHeight: 90), on: table)
        #expect(owner.displayedStops == next && owner.pending == nil)
        #expect(abs(table.rectForRow(at: index).minY - table.contentOffset.y - relative) < 1)
        // Layout remains stable after SwiftUI's hosted content has also had a turn to settle.
        try await Task.sleep(for: .milliseconds(100))
        table.layoutIfNeeded()
        #expect(abs(table.rectForRow(at: index).minY - table.contentOffset.y - relative) < 1)
    }

    @Test func variableHeightDropRetainsOneRowPerStopAndWaitsForCoherentRouteContent() async throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        let owner = fixture.owner
        table.setContentOffset(CGPoint(x: 0, y: 550), animated: false)
        _ = owner.drag.begin(at: 5)
        let source = try #require(owner.drag.source)
        let settlement = owner.drag.beginSettlement()
        #expect(owner.movePreview(source, to: 8, on: table)?.row == 8)
        var next = rows
        next.insert(next.remove(at: 5), at: 8)
        owner.update(content(next, ready: false), on: table)
        owner.drag.end()
        owner.drag.animationFinished(settlement)
        #expect(owner.displayedStops == next && owner.pending != nil)
        owner.update(content(next), on: table)
        #expect(owner.pending == nil && owner.displayedStops == next)
        #expect(table.numberOfRows(inSection: 1) == rows.count)
        table.layoutIfNeeded()
        let frames = (0..<rows.count).map { table.rectForRow(at: IndexPath(row: $0, section: 1)) }
        #expect(zip(frames, frames.dropFirst()).allSatisfy { $0.maxY <= $1.minY + 0.5 })
        #expect(Set(owner.displayedStops.map(\.id)).count == rows.count)
        #expect(table.visibleCells.allSatisfy { !($0.layer.animationKeys() ?? []).contains("position") })
    }

    @Test func statusUpdatesWaitForTheSwipeAndItsDecelerationToFinish() throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        table.setContentOffset(CGPoint(x: 0, y: 600), animated: false)
        table.layoutIfNeeded()
        table.simulatedDragging = true
        table.resetCounts()
        fixture.owner.update(content(rows, headingHeight: 80), on: table)
        #expect(table.refreshes == 0, "A status change must not reconfigure cells under the finger")
        #expect(table.offsetWrites == 0, "A SwiftUI update must not take over the scroll position")
        #expect(fixture.owner.pending != nil)

        table.simulatedDragging = false
        table.simulatedDeceleration = true
        (fixture.owner as any UIScrollViewDelegate).scrollViewDidEndDragging?(table, willDecelerate: true)
        fixture.owner.update(content(rows, headingHeight: 120), on: table)
        #expect(table.refreshes == 0 && table.offsetWrites == 0)
        table.simulatedDeceleration = false
        (fixture.owner as any UIScrollViewDelegate).scrollViewDidEndDecelerating?(table)
        #expect(fixture.owner.pending == nil)
        #expect(table.refreshes > 0, "The latest status must appear once scrolling settles")
    }

    @Test func aSwipeWithoutDecelerationFlushesAndAChangedDayNeverWaitsForOldScrolling() throws {
        let rows = stops()
        let fixture = try Fixture(content(rows))
        defer { fixture.close() }
        let table = fixture.table
        table.simulatedDragging = true
        fixture.owner.update(content(rows, headingHeight: 80), on: table)
        #expect(fixture.owner.pending != nil)
        table.simulatedDragging = false
        (fixture.owner as any UIScrollViewDelegate).scrollViewDidEndDragging?(table, willDecelerate: false)
        #expect(fixture.owner.pending == nil)
        table.setContentOffset(CGPoint(x: 0, y: 600), animated: false)
        table.simulatedDeceleration = true
        fixture.owner.update(content(Array(rows.prefix(2)), day: "next"), on: table)
        #expect(fixture.owner.displayedStops.count == 2)
        #expect(fixture.owner.pending == nil && table.contentOffset.y == 0)
    }

    private final class Fixture {
        let window: UIWindow
        let previous: UIWindow?
        let table: ObservedTable
        let owner: RouteStopList.Coordinator
        init(_ content: RouteStopList) throws {
            let scene = try #require(
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            previous = scene.windows.first { $0.isKeyWindow }
            window = UIWindow(windowScene: scene)
            let host = UIViewController()
            table = ObservedTable(frame: CGRect(x: 0, y: 0, width: 390, height: 500), style: .plain)
            owner = RouteStopList.Coordinator(content)
            RouteStopList.configureHeights(table)
            table.contentInsetAdjustmentBehavior = .never
            table.register(RouteStopCell.self, forCellReuseIdentifier: "route-stop")
            table.dataSource = owner
            table.delegate = owner
            host.view.addSubview(table)
            window.rootViewController = host
            window.makeKeyAndVisible()
            owner.update(content, on: table)
            table.reloadData()
            table.layoutIfNeeded()
            owner.drag.settled = { [weak owner, weak table] in
                if let owner, let table { owner.resumeUpdates(on: table) }
            }
        }
        func close() {
            owner.drag.cancel()
            window.isHidden = true
            window.rootViewController = nil
            previous?.makeKeyAndVisible()
        }
    }

    private final class ObservedTable: UITableView {
        var simulatedDragging = false
        var simulatedDeceleration = false
        var refreshes = 0
        var offsetWrites = 0
        override var isDragging: Bool { simulatedDragging || super.isDragging }
        override var isDecelerating: Bool { simulatedDeceleration || super.isDecelerating }
        override func reconfigureRows(at indexPaths: [IndexPath]) {
            refreshes += 1
            super.reconfigureRows(at: indexPaths)
        }
        override func setContentOffset(_ contentOffset: CGPoint, animated: Bool) {
            offsetWrites += 1
            super.setContentOffset(contentOffset, animated: animated)
        }
        func resetCounts() {
            refreshes = 0
            offsetWrites = 0
        }
    }
}
