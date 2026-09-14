import BarkDomain
import CoreImage
import Foundation
import ImageIO
import Testing
import UIKit
import UniformTypeIdentifiers

@testable import BarkRanger

private actor TestFeedback: FeedbackSending {
    var requests: [FeedbackReport] = []
    var first = true
    func submit(_ report: FeedbackReport, uid: String?) async throws -> FeedbackReceipt {
        requests.append(report)
        if first {
            first = false
            throw URLError(.networkConnectionLost)
        }
        return .init(
            reportID: report.id, filed: true, delivery: "failed", screenshotCount: report.attachments.count)
    }
}
private actor FeedbackSaveGate {
    var waiting = false
    private var continuation: CheckedContinuation<Void, Never>?
    func pause() async {
        waiting = true
        await withCheckedContinuation { continuation = $0 }
    }
    func release() {
        continuation?.resume()
        continuation = nil
    }
}
@MainActor struct SharingAndFeedbackTests {
    @Test func accountChangeDuringDraftSaveCannotSubmitAnotherAccountsReport() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let gate = FeedbackSaveGate()
        let service = TestFeedback()
        let store = FeedbackDraftStore(directory: directory, beforeSave: { await gate.pause() })
        let model = FeedbackModel(store: store, service: service)
        await model.load(uid: "a", park: nil)
        model.draft.message = "Account A private report"
        let submit = Task { await model.submit() }
        for _ in 0..<100 {
            if await gate.waiting { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        #expect(await gate.waiting)
        await model.load(uid: "b", park: nil)
        await gate.release()
        await submit.value
        #expect(await service.requests.isEmpty)
        #expect(model.draft.message.isEmpty && model.receipt == nil)
        #expect(try await store.load(owner: "account:a")?.message == "Account A private report")
        try await LocalStore.removeAccount(directory: directory, uid: "a")
        #expect(try await store.load(owner: "account:a") == nil)
    }

    @Test func imagePreparationBoundsPixelsHonorsOrientationAndStripsGPS() async throws {
        let data = try photo()
        let service = ImageExportService()
        let prepared = try await service.prepare(data, maxDimension: 900)
        let source = try #require(CGImageSourceCreateWithData(prepared as CFData, nil))
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any])
        #expect(properties[kCGImagePropertyGPSDictionary as String] == nil)
        let width = try #require(properties[kCGImagePropertyPixelWidth as String] as? Int)
        let height = try #require(properties[kCGImagePropertyPixelHeight as String] as? Int)
        #expect(max(width, height) <= 900)
        #expect(height > width)  // Orientation 6 was applied to the landscape original.
        #expect(prepared.count <= 1_500_000)
        let exported = try await service.photo(data, placement: WatermarkPlacement())
        #expect(UIImage(data: exported) != nil)
        await #expect(throws: (any Error).self) { try await service.prepare(Data("not an image".utf8)) }
    }
    @Test func cardAndQRRenderAndTemporaryExportHasOneOwner() async throws {
        let service = ImageExportService()
        let card = try await service.card(
            title: "Virtual expedition", name: "Synthetic ranger", lines: ["5.0 miles", "1 completed trail"])
        #expect(UIImage(data: card)?.size == CGSize(width: 1080, height: 1080))
        let url = try #require(URL(string: "https://maps.apple.com/?q=Acadia"))
        let qr = try await service.qr(url)
        let detector = try #require(
            CIDetector(
                ofType: CIDetectorTypeQRCode, context: nil,
                options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        let image = try #require(CIImage(data: qr))
        #expect((detector.features(in: image).first as? CIQRCodeFeature)?.messageString == url.absoluteString)
        let examples = URL.temporaryDirectory.appendingPathComponent("BarkPhase5-exports")
        try FileManager.default.createDirectory(at: examples, withIntermediateDirectories: true)
        try card.write(to: examples.appendingPathComponent("expedition-card.jpg"))
        try qr.write(to: examples.appendingPathComponent("park-qr.jpg"))
        try await service.photo(photo(), placement: WatermarkPlacement()).write(
            to: examples.appendingPathComponent("watermarked-photo.jpg"))
        let model = ExportModel()
        model.card(title: "Test", name: "Ranger", lines: ["Local test"])
        try await eventually { model.file != nil }
        let exported = try #require(model.file?.url)
        #expect(FileManager.default.fileExists(atPath: exported.path))
        model.file = nil  // SwiftUI clears the presentation binding before calling onDismiss.
        model.clearFile()
        #expect(!FileManager.default.fileExists(atPath: exported.path))
    }
    @Test func reportRetryKeepsExactBodyAndDoesNotPretendMailWasSent() async throws {
        let directory = URL.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = FeedbackDraftStore(directory: directory)
        let service = TestFeedback()
        let model = FeedbackModel(store: store, service: service)
        await model.load(uid: "a", park: nil)
        model.draft.message = "Synthetic test, never sent outside local tests."
        await model.submit()
        let saved = model.draft
        #expect(model.receipt == nil && saved.attempted)
        #expect(try await store.load(owner: "account:a") == saved)
        await model.submit()
        #expect(await service.requests == [saved, saved])
        #expect(model.receipt?.filed == true)
        #expect(model.receipt?.delivery == "failed")
        #expect(model.status?.contains("not confirmed") == true)
        await model.load(uid: "b", park: nil)
        #expect(model.draft.message.isEmpty && model.receipt == nil)
        await model.load(uid: "a", park: nil)
        #expect(model.draft == saved)
    }
    @Test(arguments: WatermarkPlacement.Corner.allCases)
    func exportedWatermarkMatchesPreviewCorner(corner: WatermarkPlacement.Corner) async throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let size = CGSize(width: 400, height: 300)
        let data = UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 1) {
            UIColor.white.setFill()
            $0.fill(CGRect(origin: .zero, size: size))
        }
        let service = ImageExportService()
        let logo = try #require(UIImage(data: await service.markPNG()))
        var placement = WatermarkPlacement()
        placement.corner = corner
        let output = try await service.photo(data, placement: placement)
        let image = try #require(UIImage(data: output)?.cgImage)
        let expected = placement.frame(in: size, markAspect: logo.size.width / logo.size.height)
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        try bytes.withUnsafeMutableBytes { buffer in
            let context = try #require(
                CGContext(
                    data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                    bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
            context.draw(image, in: CGRect(origin: .zero, size: size))
        }
        var ink = 0
        var outside = 0
        for y in 0..<image.height {
            for x in 0..<image.width {
                let pixel = (y * image.width + x) * 4
                if min(bytes[pixel], bytes[pixel + 1], bytes[pixel + 2]) < 180 {
                    ink += 1
                    if !expected.insetBy(dx: -3, dy: -3).contains(CGPoint(x: x, y: y)) { outside += 1 }
                }
            }
        }
        #expect(ink > 100, "The exported photo must actually contain the logo")
        #expect(outside == 0, "Exported ink must stay in the same corner rectangle as the preview")
    }

    @Test func csvFormulaSafetyAndFeedbackLimits() {
        #expect(VisitCSV.field("=IMPORTXML(\"bad\")") == "\"'=IMPORTXML(\"\"bad\"\")\"")
        #expect(VisitCSV.field("park,\nnext") == "\"park,\nnext\"")
        var report = FeedbackReport()
        report.message = "Valid"
        #expect(report.validationMessage == nil)
        report.message = String(repeating: "😀", count: 1001)
        #expect(report.validationMessage != nil)
        report.message = "Valid"
        report.attachments = [.init(data: Data(repeating: 0, count: 1_500_001))]
        #expect(report.validationMessage != nil)
    }
    private func photo() throws -> Data {
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 3000, height: 2000),
            format: {
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                return format
            }())
        let image = try #require(
            renderer.image { context in
                UIColor.systemTeal.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 3000, height: 2000))
            }.cgImage)
        let result = NSMutableData()
        let destination = try #require(
            CGImageDestinationCreateWithData(result, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(
            destination, image,
            [
                kCGImagePropertyOrientation: 6,
                kCGImagePropertyGPSDictionary: [
                    kCGImagePropertyGPSLatitude: 41, kCGImagePropertyGPSLongitude: 81,
                ],
            ] as CFDictionary)
        #expect(CGImageDestinationFinalize(destination))
        return result as Data
    }
}
