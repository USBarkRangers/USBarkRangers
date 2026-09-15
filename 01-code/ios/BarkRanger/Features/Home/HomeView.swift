import SwiftUI

/// Mirrors the public welcome content while keeping navigation and external links native.
struct HomeView: View {
    let open: (AppRouter.Destination) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showsQRCode = false

    private struct ResourceLink: Decodable, Identifiable {
        let title: String
        let url: URL
        var id: URL { url }
    }

    private struct Principle: Identifiable {
        let letter: String
        let text: LocalizedStringKey
        var id: String { letter }
    }

    private let links: [ResourceLink] =
        Bundle.main.url(forResource: "community-links", withExtension: "json")
        .flatMap { try? Data(contentsOf: $0) }.flatMap {
            try? JSONDecoder().decode([ResourceLink].self, from: $0)
        } ?? []

    private let principles = [
        Principle(letter: "B", text: "Bag the poo and dispose of it"),
        Principle(letter: "A", text: "Always keep your pet on a leash"),
        Principle(letter: "R", text: "Respect wildlife and other visitors"),
        Principle(letter: "K", text: "Know where you can go"),
    ]

    private var resources: [ResourceLink] {
        links.filter { ["Safety Tips", "Meet the Team", "AllTrails Trial"].contains($0.title) }
    }

    private var socialLinks: [ResourceLink] {
        links.filter { ["Facebook Group", "Instagram", "YouTube", "TikTok"].contains($0.title) }
    }

    private var store: ResourceLink? { links.first { $0.title == "Shop the Store" } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                welcome
                about
                principlesCard
                swag
                communityResources
                joinCommunity
            }
            .padding(.horizontal, 20)
            .padding(.top, 10)
            .padding(.bottom, 32)
        }
        .background(Color(uiColor: .systemGroupedBackground))
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
        .fullScreenCover(isPresented: $showsQRCode) {
            HomeQRCodePreview { showsQRCode = false }
        }
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 16) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 16) {
                    welcomeTitle
                    Spacer(minLength: 8)
                    badge(width: 72)
                }
                VStack(alignment: .leading, spacing: 14) {
                    welcomeTitle
                    badge(width: 64)
                }
            }

            Text(
                "Join our community of nearly 50,000 members as we inspire amazing travel adventures with our best friends."
            )
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 0.04, green: 0.38, blue: 0.36),
                    Color(red: 0.20, green: 0.62, blue: 0.42),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 24)
        )
        .shadow(color: .black.opacity(0.12), radius: 14, y: 7)
    }

    private var welcomeTitle: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Welcome to")
                .font(.title2.weight(.semibold))
            Text("#USBarkRangers!")
                .font(.largeTitle.bold())
                .minimumScaleFactor(0.72)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func badge(width: CGFloat) -> some View {
        Image("BarkBadge")
            .resizable()
            .scaledToFit()
            .frame(width: width)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityHidden(true)
    }

    private var about: some View {
        card(title: "What is a B.A.R.K. Ranger?", systemImage: "pawprint.fill") {
            Text(
                "If you take your pup to a park and follow the principles, they can join the ranks of #USBarkRangers! Many parks have a program where you and your pup complete fun activities to earn a badge, tag, or bandana. Some will even swear your dog in! Whether a park has a full program or simply sells tags, it is a fun way to make great memories together."
            )
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var principlesCard: some View {
        card(title: "The B.A.R.K. Principles", systemImage: "checkmark.seal.fill") {
            LazyVGrid(
                columns: dynamicTypeSize.isAccessibilitySize
                    ? [GridItem(.flexible())]
                    : [GridItem(.flexible()), GridItem(.flexible())],
                alignment: .leading,
                spacing: 12
            ) {
                ForEach(principles) { principle in
                    HStack(alignment: .top, spacing: 12) {
                        Text(principle.letter)
                            .font(.title2.bold())
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background(Color.accentColor, in: Circle())
                            .accessibilityHidden(true)
                        Text(principle.text)
                            .font(.subheadline.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
                    .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text(principle.letter + ": ") + Text(principle.text))
                }
            }

            Text("Following these principles protects the park and keeps your pup safe.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var swag: some View {
        card(title: "Official B.A.R.K. Swag", systemImage: "tag.fill") {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    swagCopy
                    swagImage(width: 86)
                }
                VStack(alignment: .leading, spacing: 14) {
                    swagCopy
                    swagImage(width: 76)
                }
            }

            if let store {
                Link(destination: store.url) {
                    Label("Shop the Store", systemImage: "bag.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .barkActionStyle(prominent: true)
                .controlSize(.large)
            }
        }
    }

    private var swagCopy: some View {
        Text(
            "Show off your B.A.R.K. Ranger pride with stickers, magnets, patches, collar tags, and durable bandanas. Shipping is always free."
        )
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func swagImage(width: CGFloat) -> some View {
        Image("BarkTag")
            .resizable()
            .scaledToFit()
            .frame(width: width)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityHidden(true)
    }

    private var communityResources: some View {
        card(title: "Community Resources", systemImage: "safari.fill") {
            ForEach(resources) { link in
                Link(destination: link.url) {
                    HStack(spacing: 12) {
                        Image(systemName: resourceSymbol(for: link.title))
                            .frame(width: 24)
                        Text(link.title).fontWeight(.semibold)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.footnote.bold())
                    }
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
            }

            Divider().padding(.vertical, 2)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { appResourceButtons }
                VStack(spacing: 12) { appResourceButtons }
            }
        }
    }

    @ViewBuilder private var appResourceButtons: some View {
        Button {
            open(.sheet(.sharing))
        } label: {
            Label("Share & export", systemImage: "square.and.arrow.up")
                .frame(maxWidth: .infinity, minHeight: 30)
        }
        .barkActionStyle()

        Button {
            open(.sheet(.support))
        } label: {
            Label("Help & feedback", systemImage: "questionmark.bubble")
                .frame(maxWidth: .infinity, minHeight: 30)
        }
        .barkActionStyle()
    }

    private var joinCommunity: some View {
        card(title: "Join the Community", systemImage: "person.3.fill", emphasized: true) {
            Text("Find trip ideas, celebrate your pup, and share your B.A.R.K. Ranger adventures with us.")
                .fixedSize(horizontal: false, vertical: true)

            LazyVGrid(
                columns: dynamicTypeSize.isAccessibilitySize
                    ? [GridItem(.flexible())]
                    : Array(repeating: GridItem(.flexible()), count: 4),
                spacing: 10
            ) {
                ForEach(socialLinks) { link in
                    Link(destination: link.url) {
                        VStack(spacing: 8) {
                            Image(systemName: socialSymbol(for: link.title))
                                .font(.title2.weight(.semibold))
                                .frame(width: 42, height: 42)
                                .background(Color.accentColor.opacity(0.14), in: Circle())
                            Text(socialTitle(for: link.title))
                                .font(.caption.weight(.semibold))
                                .multilineTextAlignment(.center)
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                        }
                        .frame(maxWidth: .infinity, minHeight: 76)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(link.title)
                }
            }

            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Official QR Code")
                        .font(.caption.bold())
                        .foregroundStyle(Color.accentColor)
                        .textCase(.uppercase)
                    Text("US BARK Rangers")
                        .font(.headline)
                    Text("Tap to enlarge")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    showsQRCode = true
                } label: {
                    Image("BarkQRCode")
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                        .frame(width: 96, height: 96)
                        .padding(6)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10))
                        .overlay {
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.black.opacity(0.10))
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open US BARK Rangers QR code")
                .accessibilityHint("Shows a larger QR code")
            }
            .padding(14)
            .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func card<Content: View>(
        title: LocalizedStringKey,
        systemImage: String,
        emphasized: Bool = false,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.title3.bold())
                    .accessibilityHidden(true)
                Text(title)
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
            }
            .foregroundStyle(emphasized ? Color.accentColor : Color.primary)
            content()
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .stroke(emphasized ? Color.accentColor.opacity(0.45) : Color.primary.opacity(0.06))
        }
        .shadow(color: .black.opacity(0.05), radius: 10, y: 4)
    }

    private func resourceSymbol(for title: String) -> String {
        switch title {
        case "Safety Tips": "shield.lefthalf.filled"
        case "Meet the Team": "person.2.fill"
        default: "figure.hiking"
        }
    }

    private func socialTitle(for title: String) -> String {
        title == "Facebook Group" ? "Facebook" : title
    }

    private func socialSymbol(for title: String) -> String {
        switch title {
        case "Facebook Group": "person.2.fill"
        case "Instagram": "camera.fill"
        case "YouTube": "play.rectangle.fill"
        default: "music.note"
        }
    }
}

private struct HomeQRCodePreview: View {
    let dismiss: () -> Void

    var body: some View {
        ZStack {
            Button(action: dismiss) {
                Color.black.opacity(0.74).ignoresSafeArea()
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss QR code")

            VStack(spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Official QR Code")
                            .font(.caption.bold())
                            .foregroundStyle(Color.accentColor)
                            .textCase(.uppercase)
                        Text("US BARK Rangers")
                            .font(.title2.bold())
                    }
                    Spacer()
                    Button(action: dismiss) {
                        Image(systemName: "xmark")
                            .font(.headline.bold())
                            .frame(width: 44, height: 44)
                            .background(.thinMaterial, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close QR code")
                }

                Image("BarkQRCode")
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .padding(10)
                    .background(.white, in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityLabel("US BARK Rangers QR code")

                Text("Scan to find US BARK Rangers online.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(20)
            .frame(maxWidth: 390)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26))
            .shadow(color: .black.opacity(0.28), radius: 26, y: 12)
            .padding(24)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("home-qr-preview")
        }
        .presentationBackground(.clear)
    }
}
