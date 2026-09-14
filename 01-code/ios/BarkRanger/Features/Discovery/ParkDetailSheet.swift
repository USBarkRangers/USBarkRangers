import SwiftUI

/// Park-specific content uses the same drag and scroll contract as route days.
struct ParkDetailSheet: View {
    let model: ParkDetailModel
    @Binding var position: MapSheetPosition
    let layout: MapSheetLayout
    let dismiss: () -> Void
    var tripAction: ParkTripAction? = nil
    var tripError: String? = nil
    var savedPlaceAction: SavedPlaceButton? = nil
    let heightChanged: (CGFloat) -> Void

    var body: some View {
        MapBottomSheet(
            position: $position, layout: layout, label: "Park detail size",
            identifier: "park-sheet-handle", heightChanged: heightChanged
        ) { presentation in
            ParkDetailView(
                model: model, position: presentation.position,
                expansion: presentation.expansion, detailExpansion: presentation.detailExpansion,
                allowsScrolling: presentation.allowsScrolling,
                bottomOverlap: layout.bottomOverlap, expand: { presentation.move(.high) },
                dismiss: dismiss, atTopChanged: presentation.atTopChanged, tripAction: tripAction,
                tripError: tripError, savedPlaceAction: savedPlaceAction)
        }
    }
}
