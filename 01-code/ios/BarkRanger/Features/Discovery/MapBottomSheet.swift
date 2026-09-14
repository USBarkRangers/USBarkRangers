import SwiftUI

struct MapSheetPresentation {
    let position: MapSheetPosition
    let expansion: CGFloat
    let detailExpansion: CGFloat
    let allowsScrolling: Bool
    let atTopChanged: (Bool) -> Void
    let move: (MapSheetPosition) -> Void
}

/// Shared map-sheet mechanics. Content owns its meaning; this container owns drag, snap and scroll arbitration.
struct MapBottomSheet<Content: View>: View {
    @Binding var position: MapSheetPosition
    let layout: MapSheetLayout
    let label: String
    let identifier: String
    let heightChanged: (CGFloat) -> Void
    var draggingEnabled = true
    @ViewBuilder let content: (MapSheetPresentation) -> Content
    @GestureState private var gestureActive = false
    @State private var translation: CGFloat = 0
    @State private var dragAllowed: Bool?
    @State private var contentAtTop = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var height: CGFloat {
        min(layout.height(at: .high), max(layout.height(at: .low), layout.height(at: position) - translation))
    }
    var body: some View {
        VStack(spacing: 0) {
            Capsule().fill(.tertiary).frame(width: 36, height: 5)
                .frame(maxWidth: .infinity).frame(height: position == .high ? 44 : 32)
                .contentShape(Rectangle()).gesture(drag(fromHandle: true))
                .onTapGesture { move(to: position == .low ? .medium : .high) }
                .accessibilityElement().accessibilityLabel(label)
                .accessibilityValue(position.label).accessibilityIdentifier(identifier)
                .accessibilityAdjustableAction { direction in
                    let change = direction == .increment ? 1 : -1
                    move(
                        to: MapSheetPosition(rawValue: max(0, min(2, position.rawValue + change)))
                            ?? position)
                }
            content(
                MapSheetPresentation(
                    position: layout.presentation(at: height), expansion: layout.expansion(at: height),
                    detailExpansion: layout.detailExpansion(at: height),
                    allowsScrolling: position == .high && dragAllowed != true,
                    atTopChanged: { contentAtTop = $0 }, move: { move(to: $0) })
            )
            .simultaneousGesture(drag(fromHandle: false))
        }
        .frame(height: height, alignment: .top)
        .background(
            Color(uiColor: .systemBackground),
            in: UnevenRoundedRectangle(
                topLeadingRadius: 28,
                bottomLeadingRadius: 0, bottomTrailingRadius: 0,
                topTrailingRadius: 28)
        )
        .clipped()
        .shadow(color: .black.opacity(0.12), radius: 12, y: -3)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            heightChanged($0)
        }
        .onChange(of: position) { _, _ in translation = 0 }
        .onChange(of: draggingEnabled) { _, enabled in
            if !enabled {
                dragAllowed = nil
                translation = 0
            }
        }
        .onChange(of: gestureActive) { _, active in
            if !active {
                dragAllowed = nil
                if translation != 0 { move(to: position) }
            }
        }
    }
    private func drag(fromHandle: Bool) -> some Gesture {
        DragGesture(minimumDistance: 8, coordinateSpace: .global)
            .updating($gestureActive) { _, active, _ in active = true }
            .onChanged { value in
                guard draggingEnabled else { return }
                if dragAllowed == nil {
                    dragAllowed =
                        abs(value.translation.height) > abs(value.translation.width)
                        && (fromHandle || position != .high || (contentAtTop && value.translation.height > 0))
                }
                if dragAllowed == true { translation = value.translation.height }
            }
            .onEnded { value in
                defer { dragAllowed = nil }
                guard draggingEnabled, dragAllowed == true else { return }
                let projected = layout.height(at: position) - value.predictedEndTranslation.height
                move(to: layout.nearest(to: projected))
            }
    }
    private func move(to next: MapSheetPosition) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.32)) {
            position = next
            translation = 0
        }
    }
}
