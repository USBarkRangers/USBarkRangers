import BarkDomain
import SwiftUI

/// Presentation arbitration only: a park temporarily covers the active day without replacing its identity.
struct MapSelectionSheets: View {
    let model: MapFeatureModel
    @Binding var parkPosition: MapSheetPosition
    let layout: MapSheetLayout
    let addStop: () -> Void
    let parkHeightChanged: (CGFloat) -> Void
    let dayHeightChanged: (CGFloat) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        ZStack(alignment: .bottom) {
            if model.detail.selection != nil {
                ParkDetailSheet(
                    model: model.detail, position: $parkPosition, layout: layout,
                    dismiss: model.cancelPlaceSelection, tripAction: tripAction,
                    tripError: model.routeDay?.editor.notice, savedPlaceAction: savedPlaceAction,
                    heightChanged: parkHeightChanged
                )
                .transition(reduceMotion ? .opacity : .move(edge: .bottom))
            } else if let day = model.routeDay, day.target != nil, day.day != nil {
                RouteDaySheet(
                    model: day, layout: layout, units: model.settings.value.units,
                    addStop: addStop, heightChanged: dayHeightChanged
                )
                .transition(reduceMotion ? .opacity : .move(edge: .bottom))
            }
        }
        .animation(.easeInOut(duration: 0.26), value: model.detail.selection != nil)
        .animation(.easeInOut(duration: 0.26), value: model.routeDay?.target != nil)
    }
    private var savedPlaceAction: SavedPlaceButton? {
        guard let saved = model.savedPlaces, let stop = model.detail.place,
            let place = SavedPlace(stop: stop, subtitle: model.detail.subtitle ?? "")
        else { return nil }
        let selectionID = model.selectionID
        return SavedPlaceButton(model: saved, place: place) {
            // A completed disk removal must not close a different pin opened in the meantime.
            if model.selectionID == selectionID { model.cancelPlaceSelection() }
        }
    }
    private var tripAction: ParkTripAction? {
        guard let day = model.routeDay, let selection = model.detail.selection else { return nil }
        return MapStopActions.action(for: selection, model: day, openDay: model.dismissPark)
    }
}
