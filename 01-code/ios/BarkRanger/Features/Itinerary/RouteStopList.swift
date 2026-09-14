import BarkDomain
import SwiftUI

/// A stable native list supports a held drag while a second finger changes the day outside the list.
/// The adapter renders store values; RouteStopDragCoordinator owns drag state and emits one move intent.
struct RouteStopList: UIViewRepresentable {
    let destination: RouteStopDragCoordinator.Destination
    let scrolling: Bool
    let bottomInset: CGFloat
    let atTopChanged: (Bool) -> Void
    let dragChanged: (Bool) -> Void
    let commit: (TripDayEdit) -> Void
    let header: AnyView
    let footer: AnyView
    var contentReady = true
    var resetsScroll = false
    var surfaceColor: UIColor = .systemBackground
    var layoutKey: (Trip.Stop, Int) -> RouteStopLayout.Key = { .init(stop: $0, number: $1) }
    let row: (Trip.Stop, Int, Bool) -> AnyView

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UITableView {
        let table = UITableView(frame: .zero, style: .plain)
        table.backgroundColor = surfaceColor
        table.separatorStyle = .none
        Self.configureHeights(table)
        table.contentInsetAdjustmentBehavior = .never
        table.register(RouteStopCell.self, forCellReuseIdentifier: "route-stop")
        table.dataSource = context.coordinator
        table.delegate = context.coordinator
        table.dragDelegate = context.coordinator.drag
        table.dropDelegate = context.coordinator.drag
        table.dragInteractionEnabled = true
        table.allowsSelection = false
        table.accessibilityIdentifier = "route-stop-list"
        context.coordinator.drag.attachFeedback(to: table)
        context.coordinator.drag.presentationChanged = { [weak owner = context.coordinator, weak table] in
            guard let owner, let table, !owner.drag.isSettling else { return }
            UIView.performWithoutAnimation {
                table.reconfigureRows(at: table.indexPathsForVisibleRows ?? [])
                table.layoutIfNeeded()
            }
        }
        context.coordinator.drag.movePreview = { [weak owner = context.coordinator] source, row, table in
            owner?.movePreview(source, to: row, on: table)
        }
        context.coordinator.drag.settled = { [weak owner = context.coordinator, weak table] in
            guard let owner, let table else { return }
            owner.resumeUpdates(on: table)
        }
        return table
    }
    static func configureHeights(_ table: UITableView) {
        // Explicit measured heights let UIKit scroll without revising estimates under the finger.
        table.estimatedRowHeight = 0
        table.estimatedSectionHeaderHeight = 0
        table.estimatedSectionFooterHeight = 0
        table.sectionHeaderHeight = 0
        table.sectionFooterHeight = 0
        table.sectionHeaderTopPadding = 0
        table.selfSizingInvalidation = .disabled
        if #available(iOS 26, *) {
            table.topEdgeEffect.isHidden = true
            table.bottomEdgeEffect.isHidden = true
        }
    }
    func updateUIView(_ table: UITableView, context: Context) {
        context.coordinator.update(self, on: table)
    }
    static func dismantleUIView(_ table: UITableView, coordinator: Coordinator) {
        coordinator.drag.destination = nil
        coordinator.pending = nil
        coordinator.drag.settled = {}
        coordinator.drag.presentationChanged = {}
        coordinator.drag.cancel()
        coordinator.drag.detachFeedback()
        coordinator.drag.movePreview = { _, _, _ in nil }
        table.dragDelegate = nil
        table.dropDelegate = nil
        table.dataSource = nil
        table.delegate = nil
    }
    final class Coordinator: NSObject, UITableViewDataSource, UITableViewDelegate {
        var parent: RouteStopList
        // Latest supplied presentation, never a speculative stop order or another editable itinerary.
        var pending: RouteStopList?
        // UITableView's rendered rows may lead the store only during a native drop. They are never saved.
        private(set) var displayedStops: [Trip.Stop]
        private var previewBase: RouteStopDragCoordinator.Destination?
        var showsDriveLegs: Bool { drag.source == nil && previewBase == nil }
        let drag = RouteStopDragCoordinator()
        private let layout = RouteStopLayout()
        private var atTop = true
        init(_ parent: RouteStopList) {
            self.parent = parent
            displayedStops = parent.destination.stops
        }
        func movePreview(_ source: RouteStopDragCoordinator.Source, to row: Int, on table: UITableView)
            -> IndexPath?
        {
            guard parent.destination.enabled, parent.destination.scope == source.scope,
                parent.destination.target.tripID == source.target.tripID
            else { return nil }
            let from =
                parent.destination.target == source.target
                ? displayedStops.firstIndex { $0.id == source.stopID } : nil
            guard parent.destination.target != source.target || from != nil else { return nil }
            guard from != nil || !displayedStops.contains(where: { $0.id == source.stopID }) else {
                return nil
            }
            var next = displayedStops
            if let from { next.remove(at: from) }
            let index = IndexPath(row: max(0, min(row, next.count)), section: 1)
            next.insert(source.stop, at: index.row)
            previewBase = parent.destination
            let anchor = RouteStopScrollAnchor(table: table, stops: displayedStops, excluding: source.stopID)
            // UIKit animates the lifted preview. A second move animation underneath it leaves ghost rows.
            UIView.performWithoutAnimation {
                table.performBatchUpdates {
                    displayedStops = next
                    if let from {
                        if from != index.row {
                            table.moveRow(at: IndexPath(row: from, section: 1), to: index)
                        }
                    } else {
                        table.insertRows(at: [index], with: .none)
                    }
                }
                table.reconfigureRows(at: table.indexPathsForVisibleRows ?? [])
                table.layoutIfNeeded()
                anchor.restore(on: table, stops: displayedStops)
            }
            return index
        }
        func update(_ next: RouteStopList, on table: UITableView) {
            if parent.destination.scope != next.destination.scope
                || parent.destination.target.tripID != next.destination.target.tripID
            {
                pending = nil
                previewBase = nil
                drag.cancel()
            }
            let changed =
                parent.destination.target != next.destination.target
                || parent.destination.scope != next.destination.scope
            // UIKit owns the offset during a swipe, deceleration and rubber-banding. Reconfiguring
            // self-sizing cells or restoring an anchor here interrupts that motion. Keep only the
            // latest presentation until it settles; navigation/collapse are intentional exceptions.
            let resetScroll = changed || (!parent.resetsScroll && next.resetsScroll)
            if !resetScroll, next.scrolling,
                table.isDragging || table.isDecelerating
            {
                pending = next
                drag.destination = nil
                return
            }
            // A pending route plan must not temporarily remove every drive row during an edit.
            guard !drag.isSettling, changed || next.contentReady else {
                pending = next
                if !drag.isSettling { drag.destination = nil }
                return
            }
            pending = nil
            let awaitingStore =
                previewBase?.target == next.destination.target
                && previewBase?.stops == next.destination.stops && !next.destination.enabled
            let rows = awaitingStore ? displayedStops : next.destination.stops
            let rowsChanged = changed || displayedStops != rows
            let anchor = rowsChanged ? RouteStopScrollAnchor(table: table, stops: displayedStops) : nil
            parent = next
            displayedStops = rows
            layout.retain(stops: rows)
            layout.prepare(for: table)
            if !awaitingStore { previewBase = nil }
            drag.destination = next.destination
            drag.commit = next.commit
            drag.dragChanged = next.dragChanged
            if table.isScrollEnabled != next.scrolling { table.isScrollEnabled = next.scrolling }
            table.backgroundColor = next.surfaceColor
            if table.contentInset.bottom != next.bottomInset { table.contentInset.bottom = next.bottomInset }
            UIView.performWithoutAnimation {
                if rowsChanged {
                    table.reloadData()
                } else if drag.source == nil {
                    table.reconfigureRows(at: table.indexPathsForVisibleRows ?? [])
                    // Recheck offscreen heights too when medium content expands or road text changes.
                    // Unchanged rows use cached measurements; no estimates settle during the next swipe.
                    table.performBatchUpdates(nil)
                }
                table.layoutIfNeeded()
                if resetScroll {
                    if table.contentOffset != .zero { table.setContentOffset(.zero, animated: false) }
                } else if rowsChanged {
                    anchor?.restore(on: table, stops: displayedStops)
                }
            }
        }
        func resumeUpdates(on table: UITableView) {
            guard let next = pending ?? (previewBase != nil ? parent : nil) else { return }
            pending = nil
            update(next, on: table)
        }
        func numberOfSections(in tableView: UITableView) -> Int { 3 }
        func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
            section == 1 ? displayedStops.count : 1
        }
        func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
            let cell = tableView.dequeueReusableCell(withIdentifier: "route-stop", for: indexPath)
            configure(cell, at: indexPath)
            return cell
        }
        func configure(_ cell: UITableViewCell, at index: IndexPath) {
            cell.backgroundColor = parent.surfaceColor
            cell.selectionStyle = .none
            (cell as? RouteStopCell)?.setContent(content(at: index))
        }
        private func content(at index: IndexPath) -> AnyView {
            let content: AnyView
            if index.section == 0 {
                content = parent.header
            } else if index.section == 2 {
                content = parent.footer
            } else if displayedStops.indices.contains(index.row) {
                content = parent.row(displayedStops[index.row], index.row, showsDriveLegs)
            } else {
                return AnyView(EmptyView())
            }
            let identity =
                index.section == 1 ? "stop:" + displayedStops[index.row].id : "section:\(index.section)"
            return AnyView(
                content.id(identity).transaction {
                    $0.animation = nil
                    $0.disablesAnimations = true
                })
        }
        func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
            .leastNormalMagnitude
        }
        func tableView(_ tableView: UITableView, heightForRowAt indexPath: IndexPath) -> CGFloat {
            // UIKit also asks again after a width/trait change without a SwiftUI data update.
            layout.prepare(for: tableView)
            let key =
                indexPath.section == 1
                ? parent.layoutKey(displayedStops[indexPath.row], indexPath.row) : nil
            return layout.height(key: key) { content(at: indexPath) }
        }
        func tableView(_ tableView: UITableView, heightForFooterInSection section: Int) -> CGFloat {
            .leastNormalMagnitude
        }
        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            let next = scrollView.contentOffset.y <= 0
            guard next != atTop else { return }
            atTop = next
            parent.atTopChanged(next)
        }
        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate, let table = scrollView as? UITableView { resumeUpdates(on: table) }
        }
        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            if let table = scrollView as? UITableView { resumeUpdates(on: table) }
        }
    }
}
