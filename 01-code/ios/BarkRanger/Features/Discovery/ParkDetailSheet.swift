import SwiftUI

/// An in-map sheet lets the real tab bar stay above low/medium content. Dragging never changes park data.
struct ParkDetailSheet: View {
    let model: ParkDetailModel
    @Binding var position: ParkSheetPosition
    let layout: ParkSheetLayout
    let dismiss: () -> Void
    let heightChanged: (CGFloat) -> Void
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
                .accessibilityElement().accessibilityLabel("Park detail size")
                .accessibilityValue(position.label).accessibilityIdentifier("park-sheet-handle")
                .accessibilityAdjustableAction { direction in
                    let change = direction == .increment ? 1 : -1
                    move(
                        to: ParkSheetPosition(rawValue: max(0, min(2, position.rawValue + change)))
                            ?? position)
                }
            ParkDetailView(
                model: model, position: $position, bottomOverlap: layout.bottomOverlap,
                dismiss: dismiss, atTopChanged: { contentAtTop = $0 }
            )
            .simultaneousGesture(drag(fromHandle: false))
        }
        .frame(height: height, alignment: .top)
        .background(
            Color(uiColor: .systemBackground),
            in: UnevenRoundedRectangle(
                topLeadingRadius: position == .high ? 0 : 28,
                bottomLeadingRadius: 0, bottomTrailingRadius: 0,
                topTrailingRadius: position == .high ? 0 : 28)
        )
        .background {
            if position == .high {
                Color(uiColor: .systemBackground).ignoresSafeArea(.container, edges: .top)
            }
        }
        .clipped()
        .shadow(color: .black.opacity(0.12), radius: 12, y: -3)
        .onGeometryChange(for: CGFloat.self) {
            $0.size.height
        } action: {
            heightChanged($0)
        }
        .onChange(of: position) { _, _ in translation = 0 }
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
                if dragAllowed == nil {
                    dragAllowed =
                        abs(value.translation.height) > abs(value.translation.width)
                        && (fromHandle || position != .high || (contentAtTop && value.translation.height > 0))
                }
                if dragAllowed == true { translation = value.translation.height }
            }
            .onEnded { value in
                defer { dragAllowed = nil }
                guard dragAllowed == true else { return }
                let projected = layout.height(at: position) - value.predictedEndTranslation.height
                move(to: layout.nearest(to: projected))
            }
    }
    private func move(to next: ParkSheetPosition) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.32)) {
            position = next
            translation = 0
        }
    }
}
