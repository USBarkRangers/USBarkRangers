import CoreTransferable
import Foundation
import UniformTypeIdentifiers

/// Bound the selected file before loading image bytes. The caller deletes this temporary copy after preparation.
nonisolated struct ImportedPhoto: Transferable, Sendable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let size = try received.file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max
            guard size > 0, size <= 40_000_000 else { throw CocoaError(.fileReadTooLarge) }
            let target = URL.temporaryDirectory.appendingPathComponent("bark-photo-\(UUID().uuidString)")
            try FileManager.default.copyItem(at: received.file, to: target)
            return Self(url: target)
        }
    }
}
