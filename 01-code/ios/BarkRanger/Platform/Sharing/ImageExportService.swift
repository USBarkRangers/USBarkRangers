import BarkDomain
import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// ImageIO decoding, orientation, metadata stripping and rendering happen off-main, with explicit pixel/byte limits.
actor ImageExportService {
    enum Failure: Error { case unreadable, tooLarge }
    private var watermark: CGImage?
    func prepare(_ data: Data, maxDimension: Int = 2048, byteLimit: Int = 1_500_000) throws -> Data {
        let image = try decode(data, maxDimension: maxDimension)
        for quality in [0.85, 0.7, 0.5, 0.3] {
            let result = try jpeg(image, quality: quality)
            if result.count <= byteLimit { return result }
        }
        throw Failure.tooLarge
    }
    func markPNG() throws -> Data {
        let data = NSMutableData()
        guard let output = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil)
        else { throw Failure.unreadable }
        CGImageDestinationAddImage(output, try mark(), nil)
        guard CGImageDestinationFinalize(output) else { throw Failure.unreadable }
        return data as Data
    }
    func photo(_ data: Data, placement: WatermarkPlacement) throws -> Data {
        let image = try decode(data, maxDimension: 2048)
        let logo = try mark()
        let context = try canvas(width: image.width, height: image.height)
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        let frame = placement.frame(
            in: CGSize(width: image.width, height: image.height),
            markAspect: Double(logo.width) / Double(logo.height))
        context.draw(
            logo,
            in: CGRect(
                x: frame.minX, y: Double(image.height) - frame.maxY,
                width: frame.width, height: frame.height))
        guard let rendered = context.makeImage() else { throw Failure.unreadable }
        return try jpeg(rendered, quality: 0.9)
    }
    func card(title: String, name: String, lines: [String]) throws -> Data {
        let context = try canvas(width: 1080, height: 1080)
        context.setFillColor(CGColor(gray: 0.04, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 1080, height: 1080))
        context.setFillColor(CGColor(gray: 0.12, alpha: 1))
        context.addPath(
            CGPath(
                roundedRect: CGRect(x: 50, y: 50, width: 980, height: 980), cornerWidth: 48, cornerHeight: 48,
                transform: nil))
        context.fillPath()
        let logo = try mark()
        let logoScale = min(180.0 / Double(logo.width), 180.0 / Double(logo.height))
        let logoWidth = Double(logo.width) * logoScale
        let logoHeight = Double(logo.height) * logoScale
        context.draw(logo, in: CGRect(x: 80, y: 1000 - logoHeight, width: logoWidth, height: logoHeight))
        let foreground = CGColor(red: 0.42, green: 0.82, blue: 0.77, alpha: 1)
        drawText(
            title, rect: CGRect(x: 90, y: 660, width: 900, height: 145), size: 58, color: foreground,
            context: context)
        drawText(
            name, rect: CGRect(x: 90, y: 555, width: 900, height: 95), size: 38,
            color: CGColor(gray: 1, alpha: 1), context: context)
        for (index, line) in lines.prefix(5).enumerated() {
            drawText(
                line, rect: CGRect(x: 90, y: 430 - index * 72, width: 900, height: 70), size: 31,
                color: CGColor(gray: 0.9, alpha: 1), context: context)
        }
        guard let image = context.makeImage() else { throw Failure.unreadable }
        return try jpeg(image, quality: 0.92)
    }
    func qr(_ url: URL) throws -> Data {
        guard ["https", "http"].contains(url.scheme), url.absoluteString.utf8.count < 2000 else {
            throw Failure.unreadable
        }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(url.absoluteString.utf8)
        guard let output = filter.outputImage?.transformed(by: .init(scaleX: 12, y: 12)),
            let image = CIContext().createCGImage(output, from: output.extent)
        else { throw Failure.unreadable }
        let context = try canvas(width: image.width + 96, height: image.height + 96)
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: image.width + 96, height: image.height + 96))
        context.interpolationQuality = .none
        context.draw(image, in: CGRect(x: 48, y: 48, width: image.width, height: image.height))
        guard let result = context.makeImage() else { throw Failure.unreadable }
        return try jpeg(result, quality: 1)
    }
    private func decode(_ data: Data, maxDimension: Int) throws -> CGImage {
        guard data.count <= 40_000_000 else { throw Failure.tooLarge }
        guard
            let source = CGImageSourceCreateWithData(
                data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
            let image = CGImageSourceCreateThumbnailAtIndex(
                source, 0,
                [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: maxDimension,
                ] as CFDictionary)
        else { throw Failure.unreadable }
        return image
    }
    private func mark() throws -> CGImage {
        if let watermark { return watermark }
        guard let url = Bundle.main.url(forResource: "WatermarkBARK", withExtension: "png") else {
            throw Failure.unreadable
        }
        let original = try decode(Data(contentsOf: url), maxDimension: 1024)
        // Existing artwork has transparent padding. Find its visible bounds once, then cache the cropped logo.
        let width = original.width
        let height = original.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let bounds: CGRect? = bytes.withUnsafeMutableBytes { buffer in
            guard
                let context = CGContext(
                    data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                    bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return nil }
            context.draw(original, in: CGRect(x: 0, y: 0, width: width, height: height))
            let values = buffer.bindMemory(to: UInt8.self)
            var left = width
            var right = 0
            var bottom = height
            var top = 0
            for y in 0..<height {
                for x in 0..<width where values[(y * width + x) * 4 + 3] > 8 {
                    left = min(left, x)
                    right = max(right, x)
                    bottom = min(bottom, y)
                    top = max(top, y)
                }
            }
            return left <= right
                ? CGRect(x: left, y: bottom, width: right - left + 1, height: top - bottom + 1) : nil
        }
        watermark = bounds.flatMap { original.cropping(to: $0) } ?? original
        return watermark ?? original
    }
    private func canvas(width: Int, height: Int) throws -> CGContext {
        guard width > 0, height > 0, width <= 4096, height <= 4096,
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw Failure.tooLarge }
        return context
    }
    private func jpeg(_ image: CGImage, quality: Double) throws -> Data {
        let data = NSMutableData()
        guard
            let destination = CGImageDestinationCreateWithData(
                data, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Failure.unreadable }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Failure.unreadable }
        return data as Data
    }
    private func drawText(_ text: String, rect: CGRect, size: CGFloat, color: CGColor, context: CGContext) {
        let value = NSAttributedString(
            string: String(text.prefix(300)),
            attributes: [
                NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName(
                    "Helvetica-Bold" as CFString, size, nil),
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
            ])
        let framesetter = CTFramesetterCreateWithAttributedString(value)
        let frame = CTFramesetterCreateFrame(
            framesetter, CFRange(location: 0, length: value.length), CGPath(rect: rect, transform: nil), nil)
        context.textMatrix = .identity
        CTFrameDraw(frame, context)
    }
}
