import BarkDomain
import SwiftUI

/// Measures the same hosted content used by the table. Heights change with content or width,
/// never because a stop has just scrolled onscreen. This cache owns layout only, not trip state.
final class RouteStopLayout {
    struct Key: Equatable {
        let stop: Trip.Stop
        let number: Int
        var segment: TripRoutePlan.Segment? = nil
        var seconds: Double? = nil
        var meters: Double? = nil
        var detailed = true
        var units = AppSettings.Units.miles
        var canEdit = true
    }
    private struct Measurement {
        let key: Key
        let height: CGFloat
    }
    private let sizingHost = UIHostingController(rootView: AnyView(EmptyView()))
    private var rows: [String: Measurement] = [:]
    private var width: CGFloat = 0
    private var textSize: UIContentSizeCategory?

    init() {
        sizingHost.safeAreaRegions = []
    }

    func retain(stops: [Trip.Stop]) {
        let ids = Set(stops.map(\.id))
        rows = rows.filter { ids.contains($0.key) }
    }

    func prepare(for table: UITableView) {
        if width != table.bounds.width || textSize != table.traitCollection.preferredContentSizeCategory {
            rows.removeAll()
            width = table.bounds.width
            textSize = table.traitCollection.preferredContentSizeCategory
        }
    }

    func height(key: Key?, content: () -> AnyView) -> CGFloat {
        if let key, let cached = rows[key.stop.id], cached.key == key { return cached.height }
        // Measurement is independent of the scroller's changing safe-area intersection.
        sizingHost.rootView = AnyView(
            content().padding(.vertical, 6)
                .environment(\.dynamicTypeSize, DynamicTypeSize(textSize ?? .large) ?? .large))
        let size = sizingHost.sizeThatFits(in: CGSize(width: max(1, width), height: .greatestFiniteMagnitude))
        let height = max(1, ceil(size.height))
        if let key { rows[key.stop.id] = Measurement(key: key, height: height) }
        return height
    }
}
