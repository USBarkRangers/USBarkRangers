import BarkDomain
import UIKit

/// Owns one native drag session. Changing the visible day never changes the captured source stop.
/// Only a completed, same-scope drop emits an edit; hovering and cancellation never save anything.
final class RouteStopDragCoordinator: NSObject, UITableViewDragDelegate, UITableViewDropDelegate {
    struct Destination {
        let scope: String
        let target: TripDayID
        let stops: [Trip.Stop]
        let enabled: Bool
    }
    struct Source {
        let sessionID: UUID
        let scope: String
        let target: TripDayID
        let stop: Trip.Stop
        var stopID: String { stop.id }
        let order: [String]
    }
    var destination: Destination?
    var commit: (TripDayEdit) -> Void = { _ in }
    var dragChanged: (Bool) -> Void = { _ in }
    var settled: () -> Void = {}
    var presentationChanged: () -> Void = {}
    var movePreview: (Source, Int, UITableView) -> IndexPath? = { _, _, _ in nil }
    private(set) var source: Source?
    enum Feedback { case pickup, insertion }
    private let feedbackOverride: ((Feedback) -> Void)?
    private(set) var pickupFeedback: UIImpactFeedbackGenerator?
    private(set) var positionFeedback: UIImpactFeedbackGenerator?
    private struct Insertion: Equatable {
        let target: TripDayID
        let row: Int
    }
    private struct Settlement {
        let id = UUID()
        var animationFinished = false
    }
    private var insertion: Insertion?
    private var settlement: Settlement?
    var isSettling: Bool { settlement != nil }

    init(feedback: ((Feedback) -> Void)? = nil) {
        feedbackOverride = feedback
        super.init()
    }
    func attachFeedback(to view: UIView) {
        pickupFeedback = UIImpactFeedbackGenerator(style: .light, view: view)
        positionFeedback = UIImpactFeedbackGenerator(style: .heavy, view: view)
        pickupFeedback?.prepare()
    }
    func detachFeedback() {
        if let pickupFeedback { pickupFeedback.view?.removeInteraction(pickupFeedback) }
        if let positionFeedback { positionFeedback.view?.removeInteraction(positionFeedback) }
        pickupFeedback = nil
        positionFeedback = nil
    }
    private func feedback(_ event: Feedback) {
        if let feedbackOverride {
            feedbackOverride(event)
            return
        }
        switch event {
        case .pickup:
            pickupFeedback?.impactOccurred(intensity: 0.65)
        case .insertion:
            positionFeedback?.impactOccurred(intensity: 1)
        }
        positionFeedback?.prepare()
    }

    func begin(at index: Int) -> UIDragItem? {
        guard !isSettling, let destination, destination.enabled, destination.stops.indices.contains(index)
        else {
            return nil
        }
        let value = Source(
            sessionID: UUID(), scope: destination.scope, target: destination.target,
            stop: destination.stops[index], order: destination.stops.map(\.id))
        source = value
        presentationChanged()
        insertion = Insertion(target: value.target, row: index)
        let item = UIDragItem(itemProvider: NSItemProvider(object: value.sessionID.uuidString as NSString))
        item.localObject = value
        feedback(.pickup)
        return item
    }
    func change(for value: Source, at row: Int) -> TripDayEdit? {
        guard accepts(value), let destination else { return nil }
        // UIKit supplies the insertion index after removing the source for an in-day move.
        let candidates = destination.stops.filter {
            destination.target != value.target || $0.id != value.stopID
        }
        let index = max(0, min(row, candidates.count))
        return .move(
            stop: value.stopID, from: value.target.dayID,
            before: index < candidates.count ? candidates[index].id : nil,
            sourceOrder: value.order, destinationOrder: destination.stops.map(\.id))
    }
    private func accepts(_ value: Source) -> Bool {
        !isSettling && source?.sessionID == value.sessionID && destination?.enabled == true
            && destination?.scope == value.scope && destination?.target.tripID == value.target.tripID
    }
    func end() {
        source = nil
        insertion = nil
        presentationChanged()
        dragChanged(false)
        resumeWhenSettled()
    }
    func lifted() {
        guard source != nil else { return }
        dragChanged(true)
    }
    func hover(at row: Int) {
        guard let source, let destination, accepts(source) else { return }
        let count = destination.stops.count - (destination.target == source.target ? 1 : 0)
        let next = Insertion(target: destination.target, row: max(0, min(row, count)))
        guard next != insertion else { return }
        insertion = next
        feedback(.insertion)
    }
    // Data-source reloads must wait for both UIKit's drop animation and its drag-session cleanup.
    func beginSettlement() -> UUID {
        let value = Settlement()
        settlement = value
        return value.id
    }
    func animationFinished(_ id: UUID) {
        guard settlement?.id == id else { return }
        settlement?.animationFinished = true
        resumeWhenSettled()
    }
    private func resumeWhenSettled() {
        guard source == nil, settlement?.animationFinished == true else { return }
        settlement = nil
        settled()
    }
    func cancel() {
        settlement = nil
        end()
    }
    private func insertionRow(_ index: IndexPath?) -> Int {
        index.map { $0.section == 0 ? 0 : $0.section == 1 ? $0.row : destination?.stops.count ?? 0 }
            ?? destination?.stops.count ?? 0
    }
    func tableView(
        _ tableView: UITableView, itemsForBeginning session: any UIDragSession,
        at indexPath: IndexPath
    ) -> [UIDragItem] {
        guard indexPath.section == 1, let item = begin(at: indexPath.row) else { return [] }
        return [item]
    }
    func tableView(_ tableView: UITableView, dragSessionWillBegin session: any UIDragSession) {
        lifted()
    }
    func tableView(_ tableView: UITableView, dragSessionDidEnd session: any UIDragSession) { end() }
    func tableView(
        _ tableView: UITableView, dragSessionIsRestrictedToDraggingApplication session: any UIDragSession
    ) -> Bool { true }
    func tableView(_ tableView: UITableView, dragSessionAllowsMoveOperation session: any UIDragSession)
        -> Bool
    { true }
    func tableView(_ tableView: UITableView, canHandle session: any UIDropSession) -> Bool {
        guard let value = session.items.first?.localObject as? Source else { return false }
        return accepts(value)
    }
    func tableView(
        _ tableView: UITableView, dropSessionDidUpdate session: any UIDropSession,
        withDestinationIndexPath destinationIndexPath: IndexPath?
    ) -> UITableViewDropProposal {
        let allowed = self.tableView(tableView, canHandle: session)
        if allowed { hover(at: insertionRow(destinationIndexPath)) }
        return UITableViewDropProposal(
            operation: allowed ? .move : .cancel, intent: .insertAtDestinationIndexPath)
    }
    func tableView(_ tableView: UITableView, performDropWith coordinator: any UITableViewDropCoordinator) {
        guard let item = coordinator.items.first, let value = item.dragItem.localObject as? Source else {
            return
        }
        let row = insertionRow(coordinator.destinationIndexPath)
        guard let edit = change(for: value, at: row) else { return }
        let settlementID = beginSettlement()
        guard let index = movePreview(value, row, tableView) else {
            cancel()
            return
        }
        // UIKit needs an actual destination row, not a free-floating preview at the finger position.
        let animation = coordinator.drop(item.dragItem, toRowAt: index)
        // Confirm the actual placement even if hovering already announced this insertion slot.
        feedback(.insertion)
        commit(edit)
        animation.addCompletion { [weak self] _ in self?.animationFinished(settlementID) }
    }
    func tableView(_ tableView: UITableView, dragPreviewParametersForRowAt indexPath: IndexPath)
        -> UIDragPreviewParameters?
    { previewParameters(tableView, indexPath) }
    func tableView(_ tableView: UITableView, dropPreviewParametersForRowAt indexPath: IndexPath)
        -> UIDragPreviewParameters?
    { previewParameters(tableView, indexPath) }
    private func previewParameters(_ table: UITableView, _ index: IndexPath) -> UIDragPreviewParameters? {
        guard let cell = table.cellForRow(at: index) else { return nil }
        let parameters = UIDragPreviewParameters()
        parameters.backgroundColor = table.backgroundColor ?? .systemBackground
        parameters.visiblePath = UIBezierPath(roundedRect: cell.bounds, cornerRadius: 12)
        return parameters
    }
}
