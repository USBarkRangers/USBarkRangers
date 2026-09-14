import Foundation

/// Lossless Firestore cursor time. Date is for display, never a round-tripped sync watermark.
public struct NativeServerTime: Codable, Equatable, Hashable, Comparable, Sendable {
    public let seconds: Int64
    public let nanoseconds: Int32
    public init(seconds: Int64, nanoseconds: Int32) throws {
        guard (-62_135_596_800...253_402_300_799).contains(seconds), (0...999_999_999).contains(nanoseconds)
        else {
            throw Failure.invalid
        }
        self.seconds = seconds
        self.nanoseconds = nanoseconds
    }
    public enum Failure: Error { case invalid }
    public var date: Date {
        Date(timeIntervalSince1970: Double(seconds) + Double(nanoseconds) / 1_000_000_000)
    }
    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.seconds == rhs.seconds ? lhs.nanoseconds < rhs.nanoseconds : lhs.seconds < rhs.seconds
    }
    enum CodingKeys: String, CodingKey { case seconds, nanoseconds }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            seconds: values.decode(Int64.self, forKey: .seconds),
            nanoseconds: values.decode(Int32.self, forKey: .nanoseconds))
    }
}
