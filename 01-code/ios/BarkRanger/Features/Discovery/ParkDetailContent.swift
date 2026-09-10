import BarkDomain
import SwiftUI

/// All supplied long-form facts and approved external links; empty fields stay omitted.
struct ParkDetailContent: View {
    let park: Park
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if park.isRetired {
                Label("This listing has been retired", systemImage: "archivebox")
            }
            section(
                "Swag",
                "\(park.swag.rawValue) · \(park.swagCost.isEmpty ? "Cost not listed" : park.swagCost)"
            )
            section("Updates and information", park.info)
            section("Entrance fees", park.entranceFees)
            section("Where to find swag", park.swagLocation)
            section("Approved areas and trails", park.approvedTrails)
            section("Restrictions", park.restrictions)
            section("Hazards and safety", park.hazards)
            section("Extra swag", park.extraSwag)
            links("Source website", urls: park.websites)
            links("Swag picture", urls: park.pictures)
            links("Swearing-in video", urls: park.videos)
            Text(
                "Park information and swag availability can change. Confirm details with the park before traveling."
            )
            .font(.footnote).foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("park-detail-content")
    }
    @ViewBuilder private func section(_ title: String, _ text: String) -> some View {
        if !text.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(.headline).accessibilityAddTraits(.isHeader)
                Text(text).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
    @ViewBuilder private func links(_ title: String, urls: [URL]) -> some View {
        if !urls.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(urls.enumerated()), id: \.offset) { index, url in
                    Link(destination: url) {
                        Label(
                            urls.count == 1 ? title : "\(title) \(index + 1)",
                            systemImage: "arrow.up.right.square"
                        ).padding(.vertical, 4)
                    }
                }
            }
        }
    }
}
