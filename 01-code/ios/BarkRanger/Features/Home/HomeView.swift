import SwiftUI

/// The welcome screen renders content and forwards navigation through its action.
struct HomeView: View {
    let open: (AppRouter.Destination) -> Void

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

                Button { open(.tab(.map)) } label: {
                    Label("Explore parks", systemImage: "map")
                        .font(.headline)
                        .foregroundStyle(.background)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .accessibilityHint("Opens the park discovery preview")

                VStack(alignment: .leading, spacing: 12) {
                    Label("Development preview", systemImage: "hammer")
                        .font(.headline)
                    Text("Welcome to the first native build. Explore the tabs while we build the tools for your adventures.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 20))
            }
            .padding(24)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("About Bark Ranger", systemImage: "info.circle") {
                    open(.sheet(.about))
                }
            }
        }
    }
}
