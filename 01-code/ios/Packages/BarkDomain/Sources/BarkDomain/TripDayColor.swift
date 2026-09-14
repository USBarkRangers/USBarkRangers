import Foundation

/// Shared day colors. Blue/black are normal pin categories; green is visited; yellow is park selection.
public struct TripDayColor: Equatable, Hashable, Sendable {
    public struct Assignment: Equatable, Sendable {
        public let dayID: String
        public let index: Int
        public let color: TripDayColor
        public init(dayID: String, index: Int, color: TripDayColor) {
            self.dayID = dayID
            self.index = index
            self.color = color
        }
    }
    public let name: String
    public let rgb: UInt32
    public var hex: String { String(format: "#%06X", rgb) }

    // Four distinct leading hues, then tonal variations for the existing 50-day trip limit.
    // Later long-trip shades still need day labels; color alone cannot distinguish 50 days reliably.
    private static let historicPalette: [Self] = {
        let bases: [(String, UInt32)] = [
            ("Purple", 0x9759FF), ("Orange", 0xF07518),
            ("Red", 0xF04452), ("Magenta", 0xDA3BC9),
        ]
        return (0..<13).flatMap { tone in
            bases.map { name, rgb in
                let amount = Double((tone + 1) / 2) * 0.055
                let channels = [16, 8, 0].map { shift -> UInt32 in
                    let value = Double((rgb >> shift) & 255)
                    return UInt32(
                        (tone.isMultiple(of: 2)
                            ? value + (255 - value) * amount : value * (1 - amount)).rounded())
                }
                return Self(
                    name: name,
                    rgb: (channels[0] << 16) | (channels[1] << 8) | channels[2])
            }
        }
    }()
    public static let palette = Array(historicPalette.prefix(4))
    private static let byHex = Dictionary(uniqueKeysWithValues: historicPalette.map { ($0.hex, $0) })
    public static func matching(_ hex: String) -> Self? { byHex[hex.uppercased()] }
    public var pickerColor: Self { Self.palette.first { $0.name == name } ?? Self.palette[0] }

    /// Saved shades remain unchanged; explicit repeated colors are respected. New days cycle base hues.
    public static func assignments(for days: [Trip.Day]) -> [Assignment] {
        days.enumerated().map { index, day in
            Assignment(
                dayID: day.id, index: index,
                color: matching(day.color) ?? palette[index % palette.count])
        }
    }
}
