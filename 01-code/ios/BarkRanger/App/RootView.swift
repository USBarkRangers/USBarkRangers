import BarkDomain
import SwiftUI

/// Assembles the shell. Future feature placeholders stay here until replaced.
struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var router: AppRouter
    let startup: StartupModel
    let discovery: MapFeatureModel
    let settings: SettingsModel
    var account: AccountModel? = nil
    var trips: TripEditorModel? = nil
    var passport: PassportModel? = nil
    var expeditions: ExpeditionModel? = nil
    var support: SupportDependencies? = nil
    var mapExpedition: MapExpeditionOverlay? = nil
    var catalog: CatalogRepository? = nil
    var purchases: PurchaseService? = nil

    var body: some View {
        Group {
            if startup.state == .ready {
                TabView(selection: $router.selectedTab) {
                    ForEach(AppRouter.Tab.allCases) { tab in
                        Tab(tab.title, systemImage: tab.symbol, value: tab) {
                            NavigationStack {
                                destination(for: tab)
                                    .navigationTitle(
                                        tab == .map || tab == .trips
                                            ? "" : tab == .home ? "Bark Ranger" : tab.title
                                    )
                                    .navigationBarTitleDisplayMode(tab == .home ? .inline : .automatic)
                                    .toolbar(
                                        tab == .map || tab == .trips || tab == .passport ? .hidden : .visible,
                                        for: .navigationBar
                                    )
                            }
                            // Account navigation/form state must not survive an identity switch.
                            .id(tab == .account ? account?.session.identity?.uid : nil)
                            // Keep the shared progress projection alive in pushed Passport destinations.
                            .task(id: tab == .passport ? passport?.input : nil) {
                                if tab == .passport { await passport?.observeProgress() }
                            }
                        }
                    }
                }
                .sheet(item: $router.sheet) { sheet in
                    switch sheet {
                    case .premium:
                        if let purchases {
                            PremiumView(model: purchases, signIn: { router.open(.tab(.account)) })
                        }
                    case .sharing:
                        if let account, let catalog {
                            NavigationStack {
                                SharingView(account: account.session, catalog: catalog).toolbar {
                                    ToolbarItem(placement: .confirmationAction) {
                                        Button("Done", action: router.dismissSheet)
                                    }
                                }
                            }
                        }
                    case .support:
                        if let support {
                            NavigationStack {
                                SupportView(dependencies: support).toolbar {
                                    ToolbarItem(placement: .confirmationAction) {
                                        Button("Done", action: router.dismissSheet)
                                    }
                                }
                            }
                        }
                    case .expeditions:
                        if let expeditions {
                            NavigationStack {
                                ExpeditionView(
                                    model: expeditions,
                                    showMap: { trail in
                                        mapExpedition?.show(trail: trail)
                                        router.open(.tab(.map))
                                    }
                                ).toolbar {
                                    ToolbarItem(placement: .confirmationAction) {
                                        Button("Done", action: router.dismissSheet)
                                    }
                                }
                            }
                        }
                    case .about: aboutSheet
                    case .settings:
                        NavigationStack {
                            SettingsView(model: settings).toolbar {
                                ToolbarItem(placement: .confirmationAction) {
                                    Button("Done", action: router.dismissSheet)
                                }
                            }
                        }
                    }
                }
            } else {
                StartupView(model: startup)
            }
        }
        .environment(\.support, support)
        .environment(\.showPremium, { router.open(.sheet(.premium)) })
        .environment(\.expeditionOverlay, mapExpedition)
        .onChange(of: router.selectedTab) { _, _ in
            // Fresh summaries are reused; entering a screen after a long foreground
            // session checks for changes without installing a background polling timer.
            account?.session.requestSync()
        }
        .task(id: expeditions?.recorder.pathRevision) {
            await mapExpedition?.updateWalk(expeditions?.recorder.points ?? [])
        }
        .task(id: account?.session.identity?.uid) {
            purchases?.activate()
            mapExpedition?.clear()
            expeditions?.resetScope()
            await expeditions?.recorder.activateAccount()
        }
        .onChange(of: account?.session.nativeVisits?.scope) { _, _ in passport?.recordActivity() }
        .onChange(of: passport?.canEdit) { _, allowed in if allowed == true { passport?.recordActivity() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                passport?.leaderboard.cancel()
            }
            if phase == .active {
                passport?.recordActivity()
                purchases?.activate()
            }
        }
        .onChange(of: account?.session.profileState?.entitlement) { _, _ in purchases?.activate() }
        .onChange(of: account?.session.identity?.uid) { _, _ in
            discovery.routeDay?.stop()
            discovery.cancelPlaceSelection()
            trips?.resetScope()
            passport?.resetScope()
        }
    }

    @ViewBuilder
    private func destination(for tab: AppRouter.Tab) -> some View {
        switch tab {
        case .home:
            HomeView(open: router.open, passport: passport, trips: trips)
        case .map:
            MapScreen(model: discovery)
        case .trips:
            if let trips {
                TripsView(
                    model: trips, units: settings.preferences.value.units,
                    previewDay: { target in
                        discovery.previewTripDay(target)
                        router.open(.tab(.map))
                    },
                    search: { request in
                        discovery.beginAdding(request) { router.open(.tab(.map)) }
                    })
            }
        case .passport:
            if let passport {
                PassportView(
                    model: passport,
                    openWalks: { router.open(.sheet(.expeditions)) },
                    share: { router.open(.sheet(.sharing)) })
            }
        case .account:
            if let account {
                AccountView(
                    model: account,
                    openSettings: { router.open(.sheet(.settings)) },
                    openSupport: { router.open(.sheet(.support)) })
            } else {
                ContentUnavailableView(
                    "Account unavailable in this preview", systemImage: "person.crop.circle")
            }
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
                    Text(
                        "Explore offline park records, local search, filters and Apple Maps directions. Premium adds account saving, park visits, trip planning and walks with virtual expeditions."
                    )
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
                        .barkActionStyle(prominent: true)
                        .controlSize(.large)
                }
                .padding()
                .background(.bar)
            }
        }
    }
}

#if DEBUG
    #Preview {
        let composition = AppSandbox().makeComposition(preview: true)
        RootView(
            router: composition.router, startup: composition.startup, discovery: composition.discovery,
            settings: composition.settings, account: composition.account, trips: composition.trips,
            passport: composition.passport)
    }

#endif
