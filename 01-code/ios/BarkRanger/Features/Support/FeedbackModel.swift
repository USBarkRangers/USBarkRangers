import BarkDomain
import Foundation
import Observation
import PhotosUI
import SwiftUI

/// One recoverable report per account scope. Once attempted its ID/body remain frozen for exact retries.
@MainActor @Observable final class FeedbackModel {
    var draft = FeedbackReport()
    private(set) var status: String?
    private(set) var busy = false
    private(set) var loaded = false
    private(set) var receipt: FeedbackReceipt?
    private let store: FeedbackDraftStore
    private let service: (any FeedbackSending)?
    private let images = ImageExportService()
    private var uid: String?
    private var owner = "guest"
    private var generation = UUID()
    private var saveTask: Task<Void, Never>?
    init(store: FeedbackDraftStore, service: (any FeedbackSending)?) {
        self.store = store
        self.service = service
    }
    func load(uid: String?, park: Park?) async {
        let token = UUID()
        generation = token
        saveTask?.cancel()
        loaded = false
        busy = true
        receipt = nil
        status = nil
        self.uid = uid
        owner = uid.map { "account:\($0)" } ?? "guest"
        do {
            let saved = try await store.load(owner: owner)
            guard !Task.isCancelled, generation == token else { return }
            draft = saved ?? FeedbackReport()
            if saved == nil, let park {
                draft.category = .correction
                draft.parkID = park.id.rawValue
                draft.location = park.name
            }
            loaded = true
        } catch {
            if generation == token {
                status = "Your saved report could not be opened. Its file has been kept."
            }
        }
        if generation == token { busy = false }
    }
    func changed() {
        guard loaded, !busy, !draft.attempted else { return }
        saveTask?.cancel()
        let draft = draft
        let owner = owner
        let token = generation
        saveTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(250))
                try await store.save(draft, owner: owner)
                if generation == token { status = "Draft saved on this iPhone" }
            } catch {
                if !Task.isCancelled, generation == token {
                    status = "Draft could not be saved. Keep this screen open and retry."
                }
            }
        }
    }
    func add(_ items: [PhotosPickerItem]) async {
        guard loaded, !busy, !draft.attempted else { return }
        let token = generation
        busy = true
        defer {
            if generation == token {
                busy = false
                changed()
            }
        }
        do {
            var attachments = draft.attachments
            for item in items.prefix(3 - attachments.count) {
                guard let photo = try await item.loadTransferable(type: ImportedPhoto.self) else { continue }
                defer { try? FileManager.default.removeItem(at: photo.url) }
                let data = try await Self.read(photo.url)
                let prepared = try await images.prepare(data, maxDimension: 1600)
                try Task.checkCancellation()
                attachments.append(.init(data: prepared))
            }
            guard generation == token else { return }
            guard attachments.reduce(0, { $0 + $1.data.count }) <= 4_000_000 else {
                status = "Images exceed 4 MB total. Select fewer images."
                return
            }
            draft.attachments = attachments
        } catch { if generation == token { status = "An image could not be prepared. Try a smaller image." } }
    }
    func submit() async {
        guard loaded, !busy, receipt == nil else { return }
        if let message = draft.validationMessage {
            status = message
            return
        }
        if uid == nil, !draft.attachments.isEmpty {
            status = "Sign in to submit attachments, or use the email option."
            return
        }
        let token = generation
        busy = true
        saveTask?.cancel()
        defer { if generation == token { busy = false } }
        do {
            draft.attempted = true
            let report = draft
            let submittingUID = uid
            let submittingOwner = owner
            try await store.save(report, owner: submittingOwner)
            guard !Task.isCancelled, generation == token else { return }
            guard let service else {
                status = "Submission is unavailable. Your draft is saved; use email or retry later."
                return
            }
            let receipt = try await service.submit(report, uid: submittingUID)
            guard !Task.isCancelled, generation == token else { return }
            self.receipt = receipt
            status =
                receipt.delivery == "sent"
                ? "Report filed. Team notification delivered."
                : "Report filed. Team notification is not confirmed. You can also send an email."
        } catch {
            if generation == token, !Task.isCancelled {
                status =
                    "Delivery could not be confirmed. Your report is saved; retry with the same report ID or use email."
            }
        }
    }
    func newReport() async {
        guard !busy, loaded else { return }
        let token = generation
        busy = true
        saveTask?.cancel()
        defer { if generation == token { busy = false } }
        let next = FeedbackReport()
        do {
            try await store.save(next, owner: owner)
            guard generation == token else { return }
            draft = next
            receipt = nil
            status = nil
        } catch {
            if generation == token {
                status = "A new draft could not be saved; the existing report is retained."
            }
        }
    }
    func flush() async {
        guard loaded else { return }
        saveTask?.cancel()
        do { try await store.save(draft, owner: owner) } catch {
            status = "Draft could not be saved. Retry before closing."
        }
    }
    @concurrent private static func read(_ url: URL) async throws -> Data {
        try Data(contentsOf: url, options: .mappedIfSafe)
    }
}
