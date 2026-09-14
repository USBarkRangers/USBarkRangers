import BarkDomain
import Foundation
import Observation
import PhotosUI
import SwiftUI

/// Owns prepared media and temporary exports only. Account/trip/visit state remains in the existing stores.
@MainActor @Observable final class ExportModel {
    struct File: Identifiable {
        let url: URL
        var id: URL { url }
    }
    let images = ImageExportService()
    private(set) var photo: UIImage?
    private(set) var logo: UIImage?
    private(set) var error: String?
    private(set) var busy = false
    var file: File?
    var placement = WatermarkPlacement()
    private var exportedURL: URL?
    private var prepared: Data?
    private var generation = UUID()
    private var operation: Task<Void, Never>?
    func select(_ item: PhotosPickerItem) async {
        operation?.cancel()
        let token = UUID()
        generation = token
        busy = true
        error = nil
        defer { if generation == token { busy = false } }
        do {
            guard let imported = try await item.loadTransferable(type: ImportedPhoto.self) else { return }
            defer { try? FileManager.default.removeItem(at: imported.url) }
            let data = try await Self.read(imported.url)
            let full = try await images.prepare(data, byteLimit: 4_000_000)
            let preview = try await images.prepare(full, maxDimension: 900)
            let mark = try await images.markPNG()
            guard !Task.isCancelled, generation == token else { return }
            prepared = full
            photo = UIImage(data: preview)
            logo = UIImage(data: mark)
            placement = WatermarkPlacement()
        } catch {
            if generation == token {
                self.error = "This photo could not be opened. Choose an image smaller than 40 MB."
            }
        }
    }
    func exportPhoto() {
        guard let prepared else { return }
        let placement = placement
        perform { [images] in try await images.photo(prepared, placement: placement) }
    }
    func card(title: String, name: String, lines: [String]) {
        perform { [images] in try await images.card(title: title, name: name, lines: lines) }
    }
    func passport(progress: NativeProgress?, name: String, catalog: CatalogRepository) {
        perform { [images] in
            guard let catalog = await catalog.current().snapshot else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            let summary = NativePassport.summary(progress: progress, catalog: catalog)
            return try await images.card(
                title: "My Bark Ranger Passport", name: name,
                lines: [
                    "\(summary.sites) sites visited",
                    "\(summary.points) points · \(summary.verifiedSites) verified", "US BARK Rangers",
                ])
        }
    }
    func qr(_ url: URL) { perform { [images] in try await images.qr(url) } }
    func visits(repository: NativeVisitRepository, catalog: CatalogRepository) {
        performFile {
            let parks = await catalog.current().snapshot?.parks ?? []
            return try await repository.exportCSV(parks: parks)
        }
    }
    private func perform(
        extension suffix: String = "jpg", _ work: @escaping @Sendable () async throws -> Data
    ) {
        performFile {
            let data = try await work()
            try Task.checkCancellation()
            return try await Self.write(data, suffix: suffix)
        }
    }
    private func performFile(_ work: @escaping @Sendable () async throws -> URL) {
        guard !busy else { return }
        clearFile()
        busy = true
        error = nil
        let token = generation
        operation = Task {
            defer {
                if generation == token {
                    busy = false
                    operation = nil
                }
            }
            do {
                let url = try await work()
                guard !Task.isCancelled, generation == token else {
                    try? FileManager.default.removeItem(at: url)
                    return
                }
                exportedURL = url
                file = File(url: url)
            } catch {
                if generation == token, !Task.isCancelled {
                    self.error = "Export could not be prepared. Please try again."
                }
            }
        }
    }
    func clearFile() {
        if let exportedURL { try? FileManager.default.removeItem(at: exportedURL) }
        exportedURL = nil
        file = nil
    }
    func clear() {
        generation = UUID()
        operation?.cancel()
        operation = nil
        busy = false
        prepared = nil
        photo = nil
        logo = nil
        clearFile()
    }
    @concurrent private static func read(_ url: URL) async throws -> Data {
        try Data(contentsOf: url, options: .mappedIfSafe)
    }
    @concurrent private static func write(_ data: Data, suffix: String) async throws -> URL {
        let url = URL.temporaryDirectory.appendingPathComponent("Bark-Ranger-\(UUID().uuidString).\(suffix)")
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
}
