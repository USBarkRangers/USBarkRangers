import BarkDomain
import FirebaseAuth
import FirebaseCore
@preconcurrency import FirebaseFirestore
import Foundation
import Testing

@testable import BarkRanger

@MainActor struct NativeAccountFeatureEmulatorTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func unavailableUnconvertedFilesCannotBlockTheNativeProfile() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Deliberately obstruct the retired transitional directory, not native storage.
        try Data("retained fixture".utf8).write(
            to: directory.appendingPathComponent("native-feature-transition"))
        let scope = UUID()
        let assembly = AccountAssembly.nativeEmulator(directory: directory, scope: scope)
        let session = assembly.session
        let model = AccountModel(session: session)
        let app = try #require(FirebaseApp.app(name: "BarkNativeUI-\(scope.uuidString)"))
        func finish() async throws {
            let store = session.nativeProfile?.store
            await session.stopAndWait()
            // A failed assertion must drain the writer too, before the defer
            // removes its fixture. CI previously removed a still-active store.
            try await store?.eraseClosedAccount()
            try await Firestore.firestore(app: app).terminate()
            await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
        }
        do {
            session.setForeground(true)
            session.connectivityChanged(true)
            // The real sign-in form is disabled until recovery finishes. Do not
            // bypass that gate by invoking the model in the same startup turn.
            try await eventually { session.cleanupState == .ready }
            model.email("\(UUID().uuidString)@native.invalid", password: "NativeOnly123!", create: true)
            #expect(
                model.action != nil,
                "Account action must start: \(session.cleanupState), \(String(describing: model.notice))")
            await model.action?.value
            #expect(model.notice == nil, "Sign-up failed: \(String(describing: model.notice))")
            // GitHub run 34924658674: the cold SDK/bootstrap request reached the
            // emulator after this check's former 5s deadline, then completed normally.
            // Match the existing trip fixture's bounded cloud-startup allowance;
            // local publication/edits below keep their original 5s deadline.
            try await eventually(timeout: .seconds(15)) {
                session.profileState?.confirmed != nil && session.nativeTrips != nil
                    && session.nativeExpeditions != nil
            }
            #expect(session.tripLibraryMessage == nil && session.nativeVisits != nil)
            #expect(
                try Data(contentsOf: directory.appendingPathComponent("native-feature-transition"))
                    == Data("retained fixture".utf8))
            #expect(session.profileState?.visible?.displayName == "Ranger")
            let uid = try #require(session.identity?.uid)
            try await NativeEmulatorFixture.seedAccess(uid: uid, app: app)
            session.requestSync(refresh: true)
            try await eventually { model.canEditData }
            model.saveName("Independent profile")
            await model.action?.value
            try await eventually { session.profileState?.confirmed?.displayName == "Independent profile" }
        } catch {
            do { try await finish() } catch { Issue.record(error) }
            throw error
        }
        try await finish()
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"] == "1"))
    func actualAccountActionsPreserveOfflineEditsLostRepliesAndReviewedConflicts() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let scope = UUID()
        let assembly = AccountAssembly.nativeEmulator(directory: directory, scope: scope)
        let session = assembly.session
        let model = AccountModel(session: session)
        let app = try #require(FirebaseApp.app(name: "BarkNativeUI-\(scope.uuidString)"))
        let auth = Auth.auth(app: app)
        let db = Firestore.firestore(app: app)
        session.setForeground(true)
        session.connectivityChanged(true)
        try await eventually { session.cleanupState == .ready }
        model.email("\(UUID().uuidString)@native.invalid", password: "NativeOnly123!", create: true)
        #expect(
            model.action != nil,
            "Account action must start: \(session.cleanupState), \(String(describing: model.notice))")
        await model.action?.value
        #expect(model.notice == nil, "Sign-up failed: \(String(describing: model.notice))")
        try await eventually(timeout: .seconds(15)) {
            session.profileState?.confirmed?.displayName == "Ranger"
        }
        try await eventually { session.nativeTrips != nil && session.nativeExpeditions != nil }
        #expect(!model.canEditData && session.capabilities.accountManagement)
        model.verifyEmail()
        await model.action?.value
        #expect(model.notice == "Verification link is in the local Auth emulator log.")
        model.resetPassword(session.identity?.email ?? "")
        await model.action?.value
        #expect(model.notice?.contains("password reset instructions") == true)
        model.unlinkApple(password: "NativeOnly123!")
        await model.action?.value
        #expect(model.notice?.contains("at least one") == true)
        model.saveName("Not permitted")
        #expect(model.notice == AccountDataAccess.readOnlyMessage)
        let uid = try #require(session.identity?.uid)
        try await NativeEmulatorFixture.seedAccess(uid: uid, app: app)
        session.requestSync(refresh: true)
        try await eventually { model.canEditData }
        session.connectivityChanged(false)
        let feature = try #require(session.nativeProfile)
        await feature.sync.pause()
        model.saveName("Offline Ranger")
        await model.action?.value
        let settings = SettingsRepository(defaults: nil, account: session)
        try await settings.setMapStyle(.satellite)
        try await eventually { session.profileState?.pendingCount == 2 }
        #expect(session.profileState?.visible?.displayName == "Offline Ranger")
        #expect(settings.value.mapStyle == .satellite)
        let retainedIDs = try #require(session.profileState?.pendingIDs)
        let command = try #require(try await feature.store.nextProfileSubmission())
        let wire = try NativeProfileCloud(uid: uid, auth: auth, db: db)
        let accepted = try await wire.submit(command)  // Intentionally lose the reply locally.
        #expect(accepted.revisions.profile == 2)
        await session.stopAndWait()
        let reopened = AccountSession(
            auth: session.auth, directory: directory,
            capabilities: AccountAssembly.capabilities,
            nativeProfileConfiguration: session.nativeProfileConfiguration)
        reopened.setForeground(true)  // Offline first; only durable local state may publish.
        try await eventually { reopened.profileState?.pendingCount == 2 }
        #expect(reopened.profileState?.pendingIDs == retainedIDs)
        #expect(reopened.profileState?.visible?.displayName == "Offline Ranger")
        reopened.connectivityChanged(true)
        try await eventually { reopened.profileState?.pendingCount == 0 }
        #expect(reopened.profileState?.confirmed?.revision == 3)
        #expect(reopened.profileState?.confirmed?.mapStyle == .satellite)
        let editor = AccountModel(session: reopened)
        reopened.connectivityChanged(false)
        let resumedFeature = try #require(reopened.nativeProfile)
        await resumedFeature.sync.pause()
        editor.saveName("Local choice")
        await editor.action?.value
        try await eventually { reopened.profileState?.pendingCount == 1 }
        let otherID = UUID()
        let other = NativeProfileCommand(
            operationID: otherID,
            createdAtMs: try NativeClientTime.milliseconds(Date()), expectedRevision: 3,
            edit: .displayName("Remote choice"))
        _ = try await wire.submit(.init(id: otherID, bytes: JSONEncoder().encode(other), attempts: 0))
        reopened.connectivityChanged(true)
        try await eventually { reopened.profileState?.pendingCount == 0 }
        #expect(reopened.profileState?.conflict == false)
        #expect(reopened.profileState?.confirmed?.displayName == "Local choice")
        #expect(reopened.profileState?.confirmed?.revision == 5)
        reopened.connectivityChanged(false)
        await resumedFeature.sync.pause()
        editor.saveName("Later typing")
        await editor.action?.value
        let appearanceID = UUID()
        let appearance = NativeProfileCommand(
            operationID: appearanceID,
            createdAtMs: try NativeClientTime.milliseconds(Date()), expectedRevision: 3,
            edit: .mapStyle(.default))
        _ = try await wire.submit(
            .init(id: appearanceID, bytes: JSONEncoder().encode(appearance), attempts: 0))
        reopened.connectivityChanged(true)
        try await eventually { reopened.profileState?.pendingCount == 0 }
        #expect(reopened.profileState?.confirmed?.displayName == "Later typing")
        #expect(reopened.profileState?.confirmed?.mapStyle == .default)
        #expect(reopened.profileState?.confirmed?.revision == 7)
        editor.signOut()
        await editor.action?.value
        try await eventually { reopened.identity == nil && reopened.profileState == nil }
        #expect(reopened.entitlement.access == nil && reopened.nativeProfile == nil)
        editor.email("\(UUID().uuidString)@native.invalid", password: "WrongPassword123!", create: false)
        await editor.action?.value
        #expect(reopened.identity == nil && editor.notice != nil)
        editor.email("\(UUID().uuidString)@native.invalid", password: "NativeOnly123!", create: true)
        await editor.action?.value
        try await eventually { reopened.profileState?.confirmed != nil }
        #expect(reopened.identity?.uid != uid && reopened.profileState?.visible?.displayName == "Ranger")
        #expect(!editor.canEditData)
        await reopened.stopAndWait()
        await wire.close()
        try await db.terminate()
        await withCheckedContinuation { continuation in app.delete { _ in continuation.resume() } }
    }
}
