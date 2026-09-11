import Foundation

/// Lossless JSON-shaped fields retain current server records that this phase does not edit.
public enum UserValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([UserValue])
    case object([String: UserValue])

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .null
        } else if let v = try? value.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? value.decode(Double.self) {
            self = .number(v)
        } else if let v = try? value.decode(String.self) {
            self = .string(v)
        } else if let v = try? value.decode([UserValue].self) {
            self = .array(v)
        } else {
            self = .object(try value.decode([String: UserValue].self))
        }
    }
    public func encode(to encoder: any Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let v): try value.encode(v)
        case .number(let v): try value.encode(v)
        case .string(let v): try value.encode(v)
        case .array(let v): try value.encode(v)
        case .object(let v): try value.encode(v)
        }
    }
    public var string: String? { if case .string(let value) = self { value } else { nil } }
    public var number: Double? { if case .number(let value) = self { value } else { nil } }
    public var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
    public var object: [String: UserValue]? { if case .object(let value) = self { value } else { nil } }
    public var array: [UserValue]? { if case .array(let value) = self { value } else { nil } }
}

extension UserValue {
    public var date: Date? {
        let value: UserValue? = self
        if let milliseconds = value?.number, milliseconds.isFinite {
            return Date(timeIntervalSince1970: milliseconds / 1000)
        }
        if let fields = value?.object, let seconds = fields["seconds"]?.number {
            return Date(timeIntervalSince1970: seconds + (fields["nanoseconds"]?.number ?? 0) / 1e9)
        }
        guard let text = value?.string else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: text)
    }
}
