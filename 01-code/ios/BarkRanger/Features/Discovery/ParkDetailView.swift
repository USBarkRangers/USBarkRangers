import BarkDomain
import SwiftUI

/// Scrollable facts and working actions, with a compact single-line preview at the low position.
struct ParkDetailView: View, Animatable {
    @Bindable var model: ParkDetailModel
    let position: ParkSheetPosition
    var expansion: CGFloat
    var animatableData: CGFloat {
        get { expansion }
        set { expansion = newValue }
    }
    let allowsScrolling: Bool
    let bottomOverlap: CGFloat
    let expand: () -> Void
    let dismiss: () -> Void
    let atTopChanged: (Bool) -> Void
    @Environment(\.dynamicTypeSize) private var textSize
    @ScaledMetric(relativeTo: .headline) private var compactTitleSize = 17
    @ScaledMetric(relativeTo: .title2) private var expandedTitleSize = 22

    var body: some View {
        let title = progress(in: 0...0.3)
        let titleFont = Font.system(
            size: compactTitleSize + (expandedTitleSize - compactTitleSize) * title, weight: .bold)
        let metadata = progress(in: 0.15...0.55)
        let photos = progress(in: 0.45...1)
        ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let park = model.park {
                        ParkDetailReveal(progress: title) {
                            Text(park.name).font(titleFont).lineLimit(1)
                                .transaction { $0.animation = nil }
                                .opacity(1 - title).accessibilityHidden(title >= 0.5)
                                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("park-detail-name")
                            Text(park.name).font(titleFont)
                                .transaction { $0.animation = nil }
                                .opacity(title).accessibilityHidden(title < 0.5)
                                .accessibilityAddTraits(.isHeader).accessibilityIdentifier("park-detail-name")
                        }
                        .clipped().padding(.trailing, 48)
                        reveal(metadata) { ParkDetailMetadata(park: park) }
                        ParkDetailActions(isOpeningMaps: model.isOpeningMaps) {
                            model.navigate()
                        } showInfo: {
                            expand()
                        }
                        .padding(.top, 12)
                        if let message = model.message {
                            Text(message).foregroundStyle(.red).padding(.top, 12)
                        }
                        reveal(photos) { ParkThumbnailStrip() }
                        if position == .high { ParkDetailContent(park: park).padding(.top, 12) }
                    } else {
                        ProgressView("Opening park details…")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20).padding(.top, 6)
                .padding(.bottom, bottomOverlap + 24).id("top")
                // Lock only the outer vertical scroll; tags/actions/photos still scroll horizontally.
                .environment(\.isScrollEnabled, true)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDisabled(!allowsScrolling)
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
            .onChange(of: allowsScrolling) { _, enabled in
                if !enabled { scroll.scrollTo("top", anchor: .top) }
            }
            .onChange(of: model.park?.id) { _, _ in scroll.scrollTo("top", anchor: .top) }
        }
        .onAppear { if textSize.isAccessibilitySize { expand() } }
    }
    // Overlapping stages follow distance, not elapsed time, so a paused/reversed drag stays coherent.
    private func progress(in range: ClosedRange<CGFloat>) -> CGFloat {
        let value = min(1, max(0, (expansion - range.lowerBound) / (range.upperBound - range.lowerBound)))
        return value * value * (3 - 2 * value)
    }
    private func reveal<Content: View>(_ progress: CGFloat, @ViewBuilder content: () -> Content) -> some View
    {
        ParkDetailReveal(progress: progress) { content() }
            .clipped().opacity(progress).padding(.top, 12 * progress)
            .accessibilityHidden(progress < 1).allowsHitTesting(progress == 1)
    }
}

/// Reveal intrinsic content height without measurement state or a fixed text/image-height assumption.
/// A second child supplies the expanded title; single-child rows reveal from zero height.
private struct ParkDetailReveal: Layout {
    var progress: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil)) }
        let collapsed = sizes.count == 2 ? sizes[0].height : 0
        let expanded = sizes.last?.height ?? 0
        return CGSize(
            width: sizes.map(\.width).max() ?? 0,
            height: collapsed + (expanded - collapsed) * min(1, max(0, progress)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for view in subviews {
            view.place(
                at: bounds.origin, anchor: .topLeading,
                proposal: ProposedViewSize(width: bounds.width, height: nil))
        }
    }
}
