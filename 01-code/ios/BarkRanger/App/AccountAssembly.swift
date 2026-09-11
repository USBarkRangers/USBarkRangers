import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import FirebaseFunctions
import Foundation

/// The only Firebase construction boundary. Missing native registration leaves public discovery available.
@MainActor struct AccountAssembly {
    let session: AccountSession
    let google: GoogleSignInAdapter?

    static func unavailable(directory: URL) -> Self {
        Self(session: AccountSession(auth: nil, cloud: nil, directory: directory), google: nil)
    }
    static func live(directory: URL) -> Self {
        guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
            let options = FirebaseOptions(contentsOfFile: path),
            options.projectID == "barkrangermap-auth",
            options.bundleID == Bundle.main.bundleIdentifier,
            options.googleAppID.range(of: "^1:[0-9]+:ios:[a-f0-9]+$", options: .regularExpression) != nil,
            let apiKey = options.apiKey, !apiKey.isEmpty
        else {
            return unavailable(directory: directory)
        }
        return make(options: options, name: "BarkNative", directory: directory, emulator: false)
    }
    #if DEBUG
        static func emulator(directory: URL, scope: UUID) -> Self {
            let options = FirebaseOptions(
                googleAppID: "1:123456789:ios:abcdef0123456789", gcmSenderID: "123456789")
            options.apiKey = "demo-barkranger-ios-api-key"
            options.projectID = "demo-barkranger-ios"
            options.bundleID = Bundle.main.bundleIdentifier ?? "swarm.USBARKRANGERS"
            return make(
                options: options, name: "BarkEmulator-\(scope.uuidString)", directory: directory,
                emulator: true)
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
    private static func make(options: FirebaseOptions, name: String, directory: URL, emulator: Bool) -> Self {
        // Firebase's registry is SDK-owned. The composition calls this once for each app/test lifetime.
        if FirebaseApp.app(name: name) == nil { FirebaseApp.configure(name: name, options: options) }
        guard let app = FirebaseApp.app(name: name) else { return unavailable(directory: directory) }
        let auth = Auth.auth(app: app)
        let db = Firestore.firestore(app: app)
        let settings = db.settings
        settings.cacheSettings = MemoryCacheSettings()
        let functions = Functions.functions(app: app, region: "us-central1")
        #if DEBUG
            if emulator {
                auth.useEmulator(withHost: "127.0.0.1", port: 9098)
                settings.host = "127.0.0.1:8088"
                settings.isSSLEnabled = false
                functions.useEmulator(withHost: "127.0.0.1", port: 5008)
            }
        #endif
        db.settings = settings
        let service = AccountService(auth: auth, isTest: emulator)
        let cloud = CloudUserClient(auth: auth, db: db, functions: functions, isTest: emulator)
        return Self(
            session: AccountSession(auth: service, cloud: cloud, directory: directory),
            google: emulator
                ? nil : GoogleSignInAdapter(clientID: configuredGoogleClientID(options), serverClientID: nil))
    }
}
