//
//  BarkRangerApp.swift
//  BarkRanger
//
//  Created by Carter Swarm on 6/6/26.
//

import SwiftUI

/// The only app entry point. The app owns one dependency graph for its lifetime.
@main
struct BarkRangerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var composition = AppComposition.makeApp()

    var body: some Scene {
        WindowGroup {
            RootView(
                router: composition.router, startup: composition.startup, discovery: composition.discovery,
                settings: composition.settings, account: composition.account
            )
            .onChange(of: scenePhase, initial: true) { _, phase in
                composition.lifecycle.sceneChanged(phase)
            }
            .onOpenURL { url in
                if composition.account.google?.handle(url) != true { composition.router.handle(url: url) }
            }
        }
    }
}
