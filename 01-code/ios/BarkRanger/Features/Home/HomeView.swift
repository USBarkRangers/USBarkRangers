import BarkDomain
import SwiftUI

/// A concise dashboard for progress, planning, community, and public resources.
struct HomeView: View {
    let open: (AppRouter.Destination) -> Void
    let passport: PassportModel?
    let trips: TripEditorModel?
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
        Principle(letter: "B", text: "Bag and dispose of pet waste"),
        Principle(letter: "A", text: "Always keep pets leashed"),
        Principle(letter: "R", text: "Respect wildlife and visitors"),
        Principle(letter: "K", text: "Know where pets can go"),
    ]

    private var resources: [ResourceLink] {
        links.filter {
            ["Safety Tips", "Meet the Team", "AllTrails Trial", "Shop the Store"].contains($0.title)
        }
    }

    private var socialLinks: [ResourceLink] {
        links.filter { ["Facebook Group", "Instagram", "YouTube", "TikTok"].contains($0.title) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                welcome
                progress
                exploreAndPlan
                principlesSection
                community
                resourceSection
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Settings", systemImage: "gearshape") { open(.sheet(.settings)) }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("About Bark Ranger", systemImage: "info.circle") { open(.sheet(.about)) }
            }
        }
        .fullScreenCover(isPresented: $showsQRCode) {
            HomeQRCodePreview { showsQRCode = false }
        }
    }

    private var welcome: some View {
        HStack(alignment: .center, spacing: 14) {
            Image("BarkBadge")
                .resizable()
                .scaledToFit()
                .frame(width: 54, height: 54)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityLabel("US BARK Rangers logo")

            VStack(alignment: .leading, spacing: 3) {
                welcomeHeading
                Text("Explore parks, plan adventures, and make memories with your best friend.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 2)
    }

    private var welcomeHeading: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(passport?.account.identity == nil ? "Welcome to" : "Welcome")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(
                passport?.account.identity == nil
                    ? "#US\u{200B}Bark\u{200B}Rangers"
                    : passport?.displayName ?? "Bark Ranger"
            )
            .font(.title2.bold())
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel(
                passport?.account.identity == nil
                    ? "#USBarkRangers"
                    : passport?.displayName ?? "Bark Ranger"
            )
        }
        .layoutPriority(1)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var progress: some View {
        sectionCard(title: "Progress", systemImage: "chart.bar.fill") {
            if passport?.account.identity == nil {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Start your passport").font(.headline)
                        Text("Sign in to record visits and earn achievements.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "book.closed.fill")
                        .foregroundStyle(Color.accentColor)
                }

                Divider()
                navigationRow("Go to Account", systemImage: "person.crop.circle") {
                    open(.tab(.account))
                }
            } else if let summary = passport?.content?.summary {
                progressStats(
                    sites: summary.sites,
                    states: summary.states.count,
                    points: summary.points
                )

                if let nextPoints = summary.level.nextPoints {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(
                            value: Double(summary.points - summary.level.minimumPoints),
                            total: Double(nextPoints - summary.level.minimumPoints)
                        )
                        .tint(Color.accentColor)
                        .accessibilityLabel("Progress to Level \(summary.level.number + 1)")
                        Text("\(nextPoints - summary.points) points to Level \(summary.level.number + 1)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Level \(summary.level.number) · \(summary.level.title)")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                }

                Divider()
                navigationRow("View Passport", systemImage: "book.closed") {
                    open(.tab(.passport))
                }
            } else {
                ProgressView("Loading progress…")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private func progressStats(sites: Int, states: Int, points: Int) -> some View {
        let stats = [
            ("Sites", sites, "mappin.and.ellipse"),
            ("States", states, "map"),
            ("Points", points, "star.fill"),
        ]

        if dynamicTypeSize.isAccessibilitySize {
            VStack(spacing: 10) {
                ForEach(stats, id: \.0) { statRow(title: $0.0, value: $0.1, systemImage: $0.2) }
            }
        } else {
            HStack(alignment: .top, spacing: 12) {
                ForEach(stats, id: \.0) {
                    statColumn(title: $0.0, value: $0.1, systemImage: $0.2)
                }
            }
        }
    }

    private func statColumn(title: String, value: Int, systemImage: String) -> some View {
        VStack(spacing: 3) {
            Label(value.formatted(), systemImage: systemImage)
                .font(.title3.bold())
                .foregroundStyle(Color.accentColor)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func statRow(title: String, value: Int, systemImage: String) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
            Spacer()
            Text(value.formatted()).fontWeight(.semibold).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private var exploreAndPlan: some View {
        sectionCard(title: "Explore & Plan", systemImage: "map.fill") {
            VStack(spacing: 0) {
                navigationRow(
                    "Explore parks",
                    detail: "Search the map and find B.A.R.K. programs",
                    systemImage: "map"
                ) { open(.tab(.map)) }

                Divider().padding(.leading, 38)

                navigationRow(
                    trips?.draft == nil ? "Plan a trip" : "Continue your trip",
                    detail: tripDetail,
                    systemImage: "point.topleft.down.to.point.bottomright.curvepath"
                ) { open(.tab(.trips)) }

                Divider().padding(.leading, 38)

                navigationRow(
                    "Walks & expeditions",
                    detail: "Record a walk and follow virtual trails",
                    systemImage: "figure.walk"
                ) { open(.sheet(.expeditions)) }
            }
        }
    }

    private var tripDetail: String {
        guard let trip = trips?.draft?.trip else { return "Build a multi-day park itinerary" }
        let stopCount = trip.days.reduce(0) { $0 + $1.stops.count }
        let name = trip.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let summary = "\(trip.days.count) days · \(stopCount) stops"
        return name.isEmpty ? summary : "\(name) · \(summary)"
    }

    private var principlesSection: some View {
        sectionCard(title: "B.A.R.K. Principles", systemImage: "checkmark.seal.fill") {
            LazyVGrid(
                columns: dynamicTypeSize.isAccessibilitySize
                    ? [GridItem(.flexible())]
                    : [GridItem(.flexible()), GridItem(.flexible())],
                alignment: .leading,
                spacing: 12
            ) {
                ForEach(principles) { principle in
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Text(principle.letter)
                            .font(.headline.bold())
                            .foregroundStyle(Color.accentColor)
                            .accessibilityHidden(true)
                        Text(principle.text)
                            .font(.subheadline)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text(principle.letter + ": ") + Text(principle.text))
                }
            }
        }
    }

    private var community: some View {
        sectionCard(title: "Community", systemImage: "person.3.fill") {
            Text(
                "Join over 50,000 members sharing park ideas, dog-friendly adventures, and B.A.R.K. Ranger experiences."
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)

            LazyVGrid(
                columns: dynamicTypeSize.isAccessibilitySize
                    ? [GridItem(.flexible()), GridItem(.flexible())]
                    : Array(repeating: GridItem(.flexible()), count: 4),
                spacing: 10
            ) {
                ForEach(socialLinks) { link in
                    Link(destination: link.url) {
                        VStack(spacing: 5) {
                            Image(systemName: socialSymbol(for: link.title))
                                .font(.title3)
                                .foregroundStyle(Color.accentColor)
                            Text(socialTitle(for: link.title))
                                .font(.caption.weight(.medium))
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity, minHeight: 52)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(link.title)
                }
            }

            Divider()

            Button {
                showsQRCode = true
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Official QR Code").font(.headline)
                        Text("Tap to enlarge and share")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Image("BarkQRCode")
                        .resizable()
                        .interpolation(.none)
                        .scaledToFit()
                        .frame(width: 56, height: 56)
                        .padding(4)
                        .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open US BARK Rangers QR code")
            .accessibilityHint("Shows a larger QR code")
        }
    }

    private var resourceSection: some View {
        sectionCard(title: "Resources", systemImage: "safari.fill") {
            VStack(spacing: 0) {
                ForEach(Array(resources.enumerated()), id: \.element.id) { index, link in
                    Link(destination: link.url) {
                        HStack(spacing: 12) {
                            Image(systemName: resourceSymbol(for: link.title))
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 24)
                                .accessibilityHidden(true)
                            Text(link.title)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                        .font(.body)
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens website")

                    if index < resources.count - 1 { Divider().padding(.leading, 36) }
                }
            }
        }
    }

    private func navigationRow(
        _ title: String,
        detail: String? = nil,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.body.weight(.medium))
                    if let detail {
                        Text(detail)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sectionCard<Content: View>(
        title: LocalizedStringKey,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .foregroundStyle(.primary)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color(uiColor: .secondarySystemGroupedBackground),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    private func resourceSymbol(for title: String) -> String {
        switch title {
        case "Safety Tips": "shield.lefthalf.filled"
        case "Meet the Team": "person.2.fill"
        case "Shop the Store": "bag.fill"
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
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                            .textCase(.uppercase)
                        Text("US BARK Rangers").font(.title2.bold())
                    }
                    Spacer()
                    Button(action: dismiss) {
                        Image(systemName: "xmark")
                            .font(.headline)
                            .frame(width: 44, height: 44)
                            .background(
                                Color(uiColor: .tertiarySystemBackground),
                                in: Circle()
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close QR code")
                }

                Image("BarkQRCode")
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .padding(10)
                    .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel("US BARK Rangers QR code")

                Text("Scan to find US BARK Rangers online.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(20)
            .frame(maxWidth: 390)
            .background(
                Color(uiColor: .secondarySystemBackground),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .padding(24)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("home-qr-preview")
        }
        .presentationBackground(.clear)
    }
}
