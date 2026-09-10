import BarkDomain
import SwiftUI

/// Scrollable facts and working actions, with a compact single-line preview at the low position.
struct ParkDetailView: View {
    @Bindable var model: ParkDetailModel
    let position: ParkSheetPosition
    let bottomOverlap: CGFloat
    let expand: () -> Void
    let dismiss: () -> Void
    let atTopChanged: (Bool) -> Void
    @Environment(\.dynamicTypeSize) private var textSize

    var body: some View {
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let park = model.park {
                        Text(park.name).font(position == .low ? .headline : .title2.bold())
                            .lineLimit(position == .low ? 1 : nil)
                            .padding(.trailing, 48).accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("park-detail-name")
                        if position != .low { ParkDetailMetadata(park: park) }
                        ParkDetailActions(isOpeningMaps: model.isOpeningMaps) {
                            model.navigate()
                        } showInfo: {
                            expand()
                        }
                        if let message = model.message { Text(message).foregroundStyle(.red) }
                        if position != .low { ParkThumbnailStrip() }
                        if position == .high { ParkDetailContent(park: park) }
                    } else {
                        ProgressView("Opening park details…")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.top, 6)
                .padding(.bottom, bottomOverlap + 24).id("top")
            }
            .scrollBounceBehavior(.basedOnSize)
            .onScrollGeometryChange(for: Bool.self) {
                $0.contentOffset.y <= 0
            } action: { _, atTop in
                atTopChanged(atTop)
            }
            .accessibilityIdentifier("park-detail-sheet")
            .mask {
                VStack(spacing: 0) {
                    Rectangle()
                    if position != .high {
                        LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                            .frame(height: max(24, bottomOverlap))
                    }
                }
            }
            .overlay(alignment: .topTrailing) {
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).frame(
                        width: 44, height: 44
                    )
                    .background(Color(uiColor: .tertiarySystemFill), in: Circle())
                }
                .tint(.primary).accessibilityLabel("Close park details").padding(.trailing, 12)
            }
            .onChange(of: position) { _, _ in scroll.scrollTo("top", anchor: .top) }
            .onChange(of: model.park?.id) { _, _ in scroll.scrollTo("top", anchor: .top) }
        }
        .onAppear { if textSize.isAccessibilitySize { expand() } }
    }
}
