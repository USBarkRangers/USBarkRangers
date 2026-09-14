import BarkDomain
import UIKit

/// Preserves a visible stop's position when self-sizing rows change. Never owns or edits stop order.
struct RouteStopScrollAnchor {
    private let stopID: String?
    private let distanceFromTop: CGFloat
    private let fallback: CGFloat

    init(table: UITableView, stops: [Trip.Stop], excluding: String? = nil) {
        fallback = table.contentOffset.y
        let index = table.indexPathsForVisibleRows?.sorted().first {
            $0.section == 1 && stops.indices.contains($0.row) && stops[$0.row].id != excluding
        }
        if fallback > 0, let index {
            stopID = stops[index.row].id
            distanceFromTop = table.rectForRow(at: index).minY - fallback
        } else {
            stopID = nil
            distanceFromTop = 0
        }
    }

    func restore(on table: UITableView, stops: [Trip.Stop]) {
        let desired =
            stopID.flatMap { id in stops.firstIndex { $0.id == id } }.map {
                table.rectForRow(at: IndexPath(row: $0, section: 1)).minY - distanceFromTop
            } ?? fallback
        let minimum = -table.adjustedContentInset.top
        let maximum = max(
            minimum, table.contentSize.height - table.bounds.height + table.adjustedContentInset.bottom)
        let offset = CGPoint(x: 0, y: min(maximum, max(minimum, desired)))
        guard abs(table.contentOffset.y - offset.y) > 0.5 else { return }
        table.setContentOffset(offset, animated: false)
    }
}
