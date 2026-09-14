import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import FirebaseFunctions
import Foundation

/// The only Firebase construction boundary. Missing native registration leaves public discovery available.
@MainActor struct AccountAssembly {
    let session: AccountSession
    let google: GoogleSignInAdapter?
    var leaderboard: (any LeaderboardReading)? = nil
    var feedback: (any FeedbackSending)? = nil
    // APPLE-ACTIVATION: owner confirmed paid enrollment is pending (2026-09-13).
    // Keep Apple hidden until the paid team's bundle capability/provisioning and the
    // native Firebase Apple provider are configured and device sign-in/link/revoke pass.
    // Activation replacement for the last argument below: appleSignIn: true
    // Approval alone is not proof that signing or Firebase provider setup is complete.
    static let capabilities = AccountCapabilities(
        profileWrites: true, authenticationChanges: true, accountManagement: false, appleSignIn: false)

    static func unavailable(directory: URL) -> Self {
        Self(session: AccountSession(auth: nil, directory: directory), google: nil)
    }
    static func live(directory: URL) -> Self {
        guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
            let options = FirebaseOptions(contentsOfFile: path),
            options.projectID == "bark-ranger-ios",
            options.bundleID == Bundle.main.bundleIdentifier,
            options.googleAppID == "1:360077919845:ios:cd94b1ea6899f95da6e88c",
            let apiKey = options.apiKey, !apiKey.isEmpty
        else {
            return unavailable(directory: directory)
        }
        return make(
            options: options, name: "BarkNative", directory: directory, emulator: false,
            capabilities: capabilities
        )
    }
    #if DEBUG
        static func nativeEmulator(directory: URL, scope: UUID, host: String = "127.0.0.1") -> Self {
            guard allowsEmulatorHost(host) else { return unavailable(directory: directory) }
            let options = FirebaseOptions(
                googleAppID: "1:123456789:ios:abcdef0123456789", gcmSenderID: "123456789")
            options.apiKey = "demo-bark-native-api-key"
            options.projectID = "demo-bark-native"
            options.bundleID = Bundle.main.bundleIdentifier ?? "swarm.USBARKRANGERS"
            return make(
                options: options, name: "BarkNativeUI-\(scope.uuidString)", directory: directory,
                emulator: true, capabilities: capabilities, emulatorHost: host)
        }
        /// Test credentials may only go to loopback or a private IPv4 address, never a public server.
        static func allowsEmulatorHost(_ host: String) -> Bool {
            if ["localhost", "127.0.0.1"].contains(host) { return true }
            let parts = host.split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 4,
                parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0 >= "0" && $0 <= "9" }) }),
                parts.allSatisfy({ UInt8($0) != nil })
            else { return false }
            let values = parts.compactMap { UInt8($0) }
            return values[0] == 10 || (values[0] == 192 && values[1] == 168)
                || (values[0] == 172 && (16...31).contains(values[1]))
        }
    #endif
    private static func configuredGoogleClientID(_ options: FirebaseOptions) -> String? {
        guard let clientID = options.clientID,
            let schemes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]],
            schemes.flatMap({ $0["CFBundleURLSchemes"] as? [String] ?? [] })
                .contains(clientID.split(separator: ".").reversed().joined(separator: "."))
        else { return nil }
        return clientID
    }
    private static func make(
        options: FirebaseOptions, name: String, directory: URL, emulator: Bool,
        capabilities: AccountCapabilities,
        emulatorHost: String = "127.0.0.1"
    ) -> Self {
        // Firebase's registry is SDK-owned. The composition calls this once for each app/test lifetime.
        NativeAppCheck.configure()
        if FirebaseApp.app(name: name) == nil { FirebaseApp.configure(name: name, options: options) }
        guard let app = FirebaseApp.app(name: name) else { return unavailable(directory: directory) }
        let auth = Auth.auth(app: app)
        let db = Firestore.firestore(app: app)
        let settings = db.settings
        settings.cacheSettings = MemoryCacheSettings()
        let functions = Functions.functions(app: app, region: "us-east1")
        let native = ["bark-ranger-ios", "demo-bark-native"].contains(options.projectID ?? "")
        #if DEBUG
            if emulator {
                auth.useEmulator(withHost: emulatorHost, port: 9198)
                settings.host = "\(emulatorHost):\(8188)"
                settings.isSSLEnabled = false
                functions.useEmulator(withHost: emulatorHost, port: 5108)
                // Firebase's Debug-only device-testing opt-in; this app contains only demo credentials.
                functions.allowInsecureTokenAttachment = true
            }
        #endif
        db.settings = settings
        let service = AccountService(auth: auth, isTest: emulator)
        if native, let project = options.projectID {
            let configuration = NativeProfileConfiguration(
                project: project,
                connect: { try NativeProfileCloud(uid: $0, auth: auth, db: db) },
                connectTrips: {
                    try NativeTripCloud(transport: NativeCallableTransport(uid: $0, auth: auth))
                },
                connectVisits: {
                    try NativeVisitCloud(transport: NativeCallableTransport(uid: $0, auth: auth))
                },
                connectExpeditions: {
                    try NativeExpeditionCloud(transport: NativeCallableTransport(uid: $0, auth: auth))
                },
                connectLeaderboard: {
                    try NativeLeaderboardRepository(
                        transport: NativeCallableTransport(uid: $0, auth: auth), uid: $0)
                })
            return Self(
                session: AccountSession(
                    auth: service, directory: directory, capabilities: capabilities,
                    nativeProfileConfiguration: configuration),
                google: emulator
                    ? nil
                    : GoogleSignInAdapter(
                        clientID: configuredGoogleClientID(options), serverClientID: nil))
        }
        return unavailable(directory: directory)
    }
}
