import Foundation

enum NativeRecordValidation {
    enum Failure: Error { case malformed }
    static let maximumInteger: Int64 = 9_007_199_254_740_991
    static func identifier(_ value: String) throws {
        guard value.utf8.count <= 128, let first = value.utf8.first,
            isLetterOrNumber(first),
            value.utf8.allSatisfy({ isLetterOrNumber($0) || [95, 58, 45].contains($0) })
        else { throw Failure.malformed }
    }
    static func revision(_ value: Int64, allowZero: Bool = false) throws {
        guard (allowZero ? 0 : 1)...maximumInteger ~= value else { throw Failure.malformed }
    }
    static func uuid(_ value: String) throws {
        guard
            value.range(
                of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                options: .regularExpression) != nil
        else {
            throw Failure.malformed
        }
    }
    static func milliseconds(_ date: Date) throws -> Int64 {
        let value = date.timeIntervalSince1970 * 1000
        guard value.isFinite, (0...253_402_300_799_999).contains(value) else { throw Failure.malformed }
        return Int64(value)
    }
    static func date(_ value: Int64) throws {
        guard (0...253_402_300_799_999).contains(value) else { throw Failure.malformed }
    }
    /// ISO calendar components, not a lenient DateFormatter that rolls February 30 forward.
    /// Shared fixtures exercise the same proleptic Gregorian dates as the native backend.
    static func calendarDate(_ value: String) throws {
        guard value.utf8.count == 10,
            value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil
        else { throw Failure.malformed }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...12).contains(parts[1]) else { throw Failure.malformed }
        let year = parts[0], month = parts[1], day = parts[2]
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard (1...lengths[month - 1]).contains(day) else { throw Failure.malformed }
    }
    static func stateCodes(_ values: [String]) throws {
        guard values.count <= 64, Set(values).count == values.count,
            values.allSatisfy({ $0.utf8.count == 2 && $0.utf8.allSatisfy({ (65...90).contains($0) }) })
        else { throw Failure.malformed }
    }
    private static func isLetterOrNumber(_ value: UInt8) -> Bool {
        (48...57).contains(value) || (65...90).contains(value) || (97...122).contains(value)
    }
}
