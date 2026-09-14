import Foundation

/// Validated client intent time, never used as a reconciliation watermark. Watermarks
/// come only from the server's lossless NativeServerTime read timestamps.
public enum NativeClientTime {
    public static func milliseconds(_ date: Date) throws -> Int64 {
        try NativeRecordValidation.milliseconds(date)
    }
}
