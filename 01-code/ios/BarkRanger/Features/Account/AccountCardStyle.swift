import SwiftUI

extension View {
    func accountCard(padding: CGFloat = 20) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 24))
    }
}

/// Account-local styling uses the existing adaptive accent and system surfaces.
struct AccountCardButtonStyle: ButtonStyle {
    var prominent = false
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, minHeight: 24)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .foregroundStyle(
                prominent ? (colorScheme == .dark ? Color.black : Color.white) : Color.accentColor
            )
            .background(
                prominent ? Color.accentColor : Color.accentColor.opacity(0.1),
                in: .rect(cornerRadius: 18)
            )
            .opacity(configuration.isPressed ? 0.75 : 1)
    }
}

struct AccountMenuRow: View {
    let title: LocalizedStringKey
    let icon: String
    let detail: String?
    @Environment(\.dynamicTypeSize) private var typeSize

    init(_ title: LocalizedStringKey, icon: String, detail: String? = nil) {
        self.title = title
        self.icon = icon
        self.detail = detail
    }

    var body: some View {
        HStack(spacing: 14) {
            // Decorative symbols keep their own column while text grows and wraps.
            Image(systemName: icon).font(.system(size: 20)).frame(width: 24).accessibilityHidden(true)
            ViewThatFits(in: .horizontal) {
                if !typeSize.isAccessibilitySize {
                    HStack(spacing: 10) {
                        Text(title)
                        Spacer(minLength: 0)
                        if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                    if let detail { Text(detail).font(.subheadline).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.tertiary).accessibilityHidden(true)
        }
        .foregroundStyle(Color.primary).fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 20).padding(.vertical, 18).frame(minHeight: 56)
        .contentShape(Rectangle()).accessibilityElement(children: .combine)
    }
}
