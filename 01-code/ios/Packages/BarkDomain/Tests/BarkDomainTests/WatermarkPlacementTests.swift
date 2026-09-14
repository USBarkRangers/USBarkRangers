import CoreGraphics
import Foundation
import Testing

@testable import BarkDomain

struct WatermarkPlacementTests {
    @Test func defaultAndDropTargetsAreOnlyCorners() {
        #expect(WatermarkPlacement().corner == .bottomRight)
        for (x, y, expected): (Double, Double, WatermarkPlacement.Corner) in [
            (0.1, 0.2, .topLeft), (0.8, 0.2, .topRight),
            (0.1, 0.8, .bottomLeft), (0.8, 0.8, .bottomRight),
            (0.49, 0.49, .topLeft), (0.5, 0.5, .bottomRight),
            (-1, 4, .bottomLeft), (.nan, 0, .bottomRight),
        ] {
            #expect(WatermarkPlacement.Corner.nearest(x: x, y: y) == expected)
        }
    }

    @Test(arguments: WatermarkPlacement.Corner.allCases)
    func resizingKeepsTheSameInsetAndCorner(corner: WatermarkPlacement.Corner) {
        let image = CGSize(width: 1200, height: 800)
        var placement = WatermarkPlacement()
        placement.corner = corner
        for width in [0.1, 0.22, 0.45] {
            placement.width = width
            let frame = placement.frame(in: image, markAspect: 0.8)
            let left = corner == .topLeft || corner == .bottomLeft
            let top = corner == .topLeft || corner == .topRight
            #expect(abs((left ? frame.minX : image.width - frame.maxX) - 24) < 0.001)
            #expect(abs((top ? frame.minY : image.height - frame.maxY) - 24) < 0.001)
            #expect(placement.corner == corner)
            let preview = placement.frame(in: CGSize(width: 300, height: 200), markAspect: 0.8)
            #expect(abs(preview.minX * 4 - frame.minX) < 0.001)
            #expect(abs(preview.minY * 4 - frame.minY) < 0.001)
            #expect(abs(preview.width * 4 - frame.width) < 0.001)
            #expect(abs(preview.height * 4 - frame.height) < 0.001)
        }
    }

    @Test func extremeAspectRatiosAndInvalidSizesRemainInsideThePhoto() {
        for size in [CGSize(width: 4000, height: 100), CGSize(width: 100, height: 4000)] {
            for corner in WatermarkPlacement.Corner.allCases {
                var placement = WatermarkPlacement()
                placement.corner = corner
                for width in [Double.nan, -1, 5] {
                    placement.width = width
                    let frame = placement.frame(in: size, markAspect: 0.8)
                    #expect(frame.width > 0 && frame.height > 0)
                    #expect(CGRect(origin: .zero, size: size).contains(frame))
                    #expect(abs(frame.width / frame.height - 0.8) < 0.001)
                }
            }
        }
        #expect(WatermarkPlacement().frame(in: .zero, markAspect: 0) == .zero)
        let frame = WatermarkPlacement().frame(in: CGSize(width: 300, height: 400), markAspect: .nan)
        #expect(frame.width == frame.height && frame.minX > 0 && frame.minY > 0)
    }
}
