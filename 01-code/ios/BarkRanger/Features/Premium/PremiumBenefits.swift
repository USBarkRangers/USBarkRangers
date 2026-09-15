import SwiftUI

/// Customer-facing benefits of features that ship today. Journal, cloud photos and
/// multiple dogs are roadmap items, not promises on the purchase screen.
struct PremiumBenefits: View {
    var body: some View {
        Section {
            benefit(
                "Your park passport", icon: "pawprint.fill",
                detail: "Record park visits, earn points and see where you’ve been.")
            benefit(
                "Places worth keeping", icon: "mappin.and.ellipse",
                detail: "Save places you find on the map, ready for your next adventure.")
            benefit(
                "Trips, your way", icon: "point.topleft.down.to.point.bottomright.curvepath",
                detail: "Plan multi-day trips, arrange stops, keep notes and open directions.")
            benefit(
                "Walks and expeditions", icon: "figure.walk",
                detail: "Record your walks and make progress on virtual expeditions.")
            benefit(
                "Ready when you’re offline", icon: "wifi.slash",
                detail: "Save offline. Sync when you reconnect."
            )
        } header: {
            Text("Included with Premium").foregroundStyle(Color.primary)
        } footer: {
            Text(
                "Map tiles, place search, new directions and Apple purchases need an internet connection. Your saved information remains readable if Premium ends."
            )
            .foregroundStyle(Color.primary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func benefit(_ title: LocalizedStringKey, icon: String, detail: LocalizedStringKey) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon).font(.title3).foregroundStyle(Color.accentColor)
                .frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).fixedSize(horizontal: false, vertical: true)
                Text(detail).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
