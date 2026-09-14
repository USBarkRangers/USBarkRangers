import CoreGraphics
import Foundation

public struct WatermarkPlacement: Equatable, Sendable {
    public enum Corner: String, CaseIterable, Sendable {
        case topLeft = "Top left"
        case topRight = "Top right"
        case bottomLeft = "Bottom left"
        case bottomRight = "Bottom right"

        /// Same quadrant rule as the web tool; ties land on the right/bottom.
        public static func nearest(x: Double, y: Double) -> Self {
            guard x.isFinite, y.isFinite else { return .bottomRight }
            return y < 0.5 ? (x < 0.5 ? .topLeft : .topRight) : (x < 0.5 ? .bottomLeft : .bottomRight)
        }
    }
    public var corner: Corner = .bottomRight
    public var width: Double = 0.22
    public init() {}

    /// Top-left image coordinates shared by preview and export. Insets measure the trimmed artwork,
    /// not transparent padding. Very wide photos constrain logo size so it always fits the image.
    public func frame(in image: CGSize, markAspect: Double) -> CGRect {
        guard image.width.isFinite, image.height.isFinite, image.width > 0, image.height > 0 else {
            return .zero
        }
        let aspect = markAspect.isFinite && markAspect > 0 ? markAspect : 1
        let fraction = min(0.45, max(0.10, width.isFinite ? width : 0.22))
        let inset = min(image.width * 0.02, min(image.width, image.height) / 4)
        let markWidth = min(image.width * fraction, (image.height - inset * 2) * aspect)
        let markHeight = markWidth / aspect
        let left = corner == .topLeft || corner == .bottomLeft
        let top = corner == .topLeft || corner == .topRight
        return CGRect(
            x: left ? inset : image.width - inset - markWidth,
            y: top ? inset : image.height - inset - markHeight,
            width: markWidth, height: markHeight)
    }
}
