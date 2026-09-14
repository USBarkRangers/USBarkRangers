import BarkDomain
import SwiftUI
import Testing

@testable import BarkRanger

@MainActor struct RouteStopMeasurementTests {
    private func stop(_ index: Int = 0) -> Trip.Stop {
        Trip.Stop(id: "stop-\(index)", placeIdentity: .custom("pin-\(index)"),
            name: "Muskingum Area, US Army Corps of Engineers 49320 CR 497 Coshocton, OH 43812",
            coordinate: nil, state: "Ohio")
    }

    @Test func widthAndTextSizeReflowButScrollingDoesNotRemeasure() {
        let layout = RouteStopLayout()
        let table = UITableView(frame: CGRect(x: 0, y: 0, width: 390, height: 500))
        let key = RouteStopLayout.Key(stop: stop(), number: 0)
        var measurements = 0
        let content = {
            measurements += 1
            return AnyView(StopTimelineRow(stop: key.stop, number: 1, detailed: true))
        }
        layout.prepare(for: table)
        let wide = layout.height(key: key, content: content)
        for offset in 0..<100 {
            table.contentOffset.y = CGFloat(offset * 10)
            layout.prepare(for: table)
            #expect(layout.height(key: key, content: content) == wide)
        }
        #expect(measurements == 1)
        table.bounds.size.width = 280
        layout.prepare(for: table)
        let narrow = layout.height(key: key, content: content)
        #expect(narrow > wide && measurements == 2)
        table.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        table.updateTraitsIfNeeded()
        layout.prepare(for: table)
        #expect(layout.height(key: key, content: content) > narrow)
        #expect(measurements == 3)
    }

    @Test func changedNoteRemeasuresOnlyThatStopAndUncachedHeaderIgnoresScrollPosition() {
        let layout = RouteStopLayout()
        let table = UITableView(frame: CGRect(x: 0, y: 0, width: 335, height: 500))
        layout.prepare(for: table)
        let original = stop()
        var updated = original
        updated.notes = String(repeating: "A longer visit note. ", count: 20)
        let before = layout.height(key: .init(stop: original, number: 0)) {
            AnyView(StopTimelineRow(stop: original, number: 1, detailed: true))
        }
        let after = layout.height(key: .init(stop: updated, number: 0)) {
            AnyView(StopTimelineRow(stop: updated, number: 1, detailed: true))
        }
        #expect(after > before)
        for offset in [0.0, 500, 1500, -60] {
            table.contentOffset.y = offset
            layout.prepare(for: table)
            let height = layout.height(key: nil) { AnyView(Text("Status").frame(height: 30)) }
            #expect(height == 42)
        }
    }

    @Test func largeDayMeasuresOnceAndSubsequentScrollReadsUseTheCache() {
        let layout = RouteStopLayout()
        let table = UITableView(frame: CGRect(x: 0, y: 0, width: 335, height: 600))
        layout.prepare(for: table)
        let stops = (0..<393).map { stop($0) }
        var measurements = 0
        let start = ContinuousClock.now
        for (index, stop) in stops.enumerated() {
            _ = layout.height(key: .init(stop: stop, number: index)) {
                measurements += 1
                return AnyView(StopTimelineRow(stop: stop, number: index + 1, detailed: true))
            }
        }
        let first = start.duration(to: .now)
        let cachedStart = ContinuousClock.now
        for _ in 0..<10 {
            for (index, stop) in stops.enumerated() {
                _ = layout.height(key: .init(stop: stop, number: index)) {
                    measurements += 1
                    return AnyView(EmptyView())
                }
            }
        }
        #expect(measurements == 393)
        print("393-stop layout: first \(first), 3,930 cached reads \(cachedStart.duration(to: .now))")
    }
}
