import SwiftUI

/// The welcome screen renders content and forwards navigation through its action.
struct HomeView: View {
    let open: (AppRouter.Destination) -> Void
    private let education =
        Bundle.main.url(forResource: "education", withExtension: "txt").flatMap {
            try? String(contentsOf: $0, encoding: .utf8)
        } ?? "Follow the B.A.R.K. principles and confirm park rules before visiting."

    private struct ResourceLink: Decodable, Identifiable {
        let title: String
        let url: URL
        var id: URL { url }
    }
    private let links: [ResourceLink] =
        Bundle.main.url(forResource: "community-links", withExtension: "json")
        .flatMap { try? Data(contentsOf: $0) }.flatMap {
            try? JSONDecoder().decode([ResourceLink].self, from: $0)
        } ?? []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 18) {
                    Image("BarkBadge")
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 140)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .accessibilityHidden(true)
                    Text("Happy trails.")
                        .font(.largeTitle.bold())
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text("Find your next adventure together.")
                        .font(.title3)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    open(.tab(.map))
                } label: {
                    Label("Explore parks", systemImage: "map")
                        .font(.headline)
                        .foregroundStyle(.background)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityHint("Opens the park map and searchable results")

                VStack(alignment: .leading, spacing: 12) {
                    Label("The B.A.R.K. principles", systemImage: "pawprint")
                        .font(.headline)
                    ForEach(Array(education.split(separator: "\n").enumerated()), id: \.offset) {
                        _, paragraph in
                        Text(String(paragraph)).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .foregroundStyle(Color.primary)
                .background(
                    Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20))
                VStack(alignment: .leading, spacing: 16) {
                    Text("Community resources").font(.headline).accessibilityAddTraits(.isHeader)
                    ForEach(links) { link in
                        Link(destination: link.url) {
                            Label(link.title, systemImage: "arrow.up.right.square").frame(
                                minHeight: 44, alignment: .leading)
                        }
                    }
                }
            }
            .padding(24)
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Settings", systemImage: "gearshape") { open(.sheet(.settings)) }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("About Bark Ranger", systemImage: "info.circle") {
                    open(.sheet(.about))
                }
            }
        }
    }
}
