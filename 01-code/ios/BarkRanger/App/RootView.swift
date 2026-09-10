import SwiftUI

/// Assembles the shell. Future feature placeholders stay here until replaced.
struct RootView: View {
    @Bindable var router: AppRouter
    let startup: StartupModel

    var body: some View {
        Group {
            if startup.state == .ready {
                TabView(selection: $router.selectedTab) {
                    ForEach(AppRouter.Tab.allCases) { tab in
                        Tab(tab.title, systemImage: tab.symbol, value: tab) {
                            NavigationStack {
                                destination(for: tab)
                                    .navigationTitle(tab == .home ? "Bark Ranger" : tab.title)
                            }
                        }
                    }
                }
                .sheet(item: $router.sheet) { sheet in
                    switch sheet {
                    case .about: aboutSheet
                    }
                }
            } else {
                StartupView(model: startup)
            }
        }
    }

    @ViewBuilder
    private func destination(for tab: AppRouter.Tab) -> some View {
        switch tab {
        case .home:
            HomeView(open: router.open)
        case .map:
            developmentScreen("Park discovery is on the way", symbol: tab.symbol,
                              detail: "Offline parks, search and maps will arrive in phase 2.")
        case .trips:
            developmentScreen("Room for your next adventure", symbol: tab.symbol,
                              detail: "Trip planning and saved routes will arrive in phase 4.")
        case .passport:
            developmentScreen("Every visit tells a story", symbol: tab.symbol,
                              detail: "Park visits, stamps and achievements will arrive in phase 4.")
        case .account:
            developmentScreen("Your ranger profile starts here", symbol: tab.symbol,
                              detail: "Sign-in and account settings will arrive in phase 3.")
        }
    }

    private func developmentScreen(
        _ title: LocalizedStringKey, symbol: String, detail: LocalizedStringKey
    ) -> some View {
        ScrollView {
            ContentUnavailableView {
                Label(title, systemImage: symbol)
            } description: {
                Text("Development preview")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(detail)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            } actions: {
                Button("Back to Home") { router.open(.tab(.home)) }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
            }
            .padding(.vertical, 32)
        }
    }

    private var aboutSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Label("Made for you and your trail buddy", systemImage: "pawprint.fill")
                        .font(.title2.bold())
                    Text("A new native home for US BARK Rangers.")
                    Text("Development preview")
                        .font(.headline)
                    Text("This first build lets you explore the app’s navigation. Parks, accounts and adventure tools are still being built.")
                    Text("Your existing Bark Ranger app is still available as usual.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(24)
            }
            .navigationTitle("About Bark Ranger")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                HStack {
                    Spacer()
                    Button("Done", action: router.dismissSheet)
                        .font(.body)
                        .foregroundStyle(.background)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                }
                .padding()
                .background(.bar)
            }
        }
    }
}

#Preview {
    let composition = AppComposition.makePreview()
    RootView(router: composition.router, startup: composition.startup)
}
