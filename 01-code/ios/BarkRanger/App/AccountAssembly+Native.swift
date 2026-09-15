import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import FirebaseFunctions
import Foundation

extension AccountAssembly {
    /// Shipping native profile factory. Feature construction stays in the account
    /// composition boundary, not in view models or the historical account graph.
    static func nativeProfile(app: FirebaseApp, uid: String) throws -> NativeProfileCloud {
        guard app.options.projectID == "bark-ranger-ios" else { throw NativeProfileCloud.Failure.wrongScope }
        return try NativeProfileCloud(uid: uid, auth: Auth.auth(app: app), db: Firestore.firestore(app: app))
    }

    #if DEBUG
        static func nativeProfileEmulator(scope: UUID) throws -> (FirebaseApp, Auth, Firestore) {
            let name = "BarkNativeProfile-\(scope.uuidString)"
            guard FirebaseApp.app(name: name) == nil else { throw NativeProfileCloud.Failure.wrongScope }
            let options = FirebaseOptions(
                googleAppID: "1:123456789:ios:abcdef0123456789", gcmSenderID: "123456789")
            options.apiKey = "demo-bark-native-api-key"
            options.projectID = "demo-bark-native"
            options.bundleID = Bundle.main.bundleIdentifier ?? "swarm.USBARKRANGERS"
            NativeAppCheck.configure()
            FirebaseApp.configure(name: name, options: options)
            guard let app = FirebaseApp.app(name: name) else { throw NativeProfileCloud.Failure.wrongScope }
            let auth = Auth.auth(app: app)
            auth.useEmulator(withHost: "127.0.0.1", port: 9198)
            let db = Firestore.firestore(app: app)
            let settings = db.settings
            settings.cacheSettings = MemoryCacheSettings()
            settings.host = "127.0.0.1:8188"
            settings.isSSLEnabled = false
            db.settings = settings
            let functions = Functions.functions(app: app, region: "us-east1")
            functions.useEmulator(withHost: "127.0.0.1", port: 5108)
            functions.allowInsecureTokenAttachment = true
            return (app, auth, db)
        }

        static func nativeProfileEmulatorClient(app: FirebaseApp, uid: String) throws -> NativeProfileCloud {
            guard app.options.projectID == "demo-bark-native",
                Firestore.firestore(app: app).settings.host == "127.0.0.1:8188"
            else { throw NativeProfileCloud.Failure.wrongScope }
            return try NativeProfileCloud(
                uid: uid, auth: Auth.auth(app: app), db: Firestore.firestore(app: app))
        }
    #endif
}
