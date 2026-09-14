import CryptoKit
import Foundation

/// Identity is independent of labels, coordinates and the number of trips using a place.
/// J1: journal membership is separate from identity; referencing a place does not star it on the map.
public enum PlaceIdentity: Codable, Hashable, Sendable {
    case official(ParkID)
    case provider(name: String, id: String)
    case custom(String)

    public var isValid: Bool {
        switch self {
        case .official(let id): return Self.valid(id.rawValue)
        case .provider(let name, let id): return Self.valid(name) && Self.valid(id)
        case .custom(let id): return Self.valid(id)
        }
    }

    /// Length-prefixed UTF-8 components avoid delimiter ambiguity across Swift and backend code.
    public var storageID: String {
        let parts: [String]
        switch self {
        case .official(let id): parts = ["official", id.rawValue]
        case .provider(let name, let id): parts = ["provider", name, id]
        case .custom(let id): parts = ["custom", id]
        }
        let input = parts.map { "\($0.utf8.count):\($0)" }.joined()
        return SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func valid(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 1_024
            && !value.unicodeScalars.contains { $0.properties.generalCategory == .control }
    }

    private enum CodingKeys: String, CodingKey { case kind, id, provider }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try values.decode(String.self, forKey: .kind)
        let id = try values.decode(String.self, forKey: .id)
        switch kind {
        case "official": self = .official(ParkID(rawValue: id))
        case "provider": self = .provider(name: try values.decode(String.self, forKey: .provider), id: id)
        case "custom": self = .custom(id)
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: values,
                debugDescription: "Unsupported place identity kind")
        }
        guard isValid, kind == "provider" || !values.contains(.provider) else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: values,
                debugDescription: "Invalid place identity")
        }
    }

    public func encode(to encoder: any Encoder) throws {
        guard isValid else {
            throw EncodingError.invalidValue(self, .init(codingPath: encoder.codingPath,
                debugDescription: "Invalid place identity"))
        }
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .official(let id):
            try values.encode("official", forKey: .kind)
            try values.encode(id.rawValue, forKey: .id)
        case .provider(let name, let id):
            try values.encode("provider", forKey: .kind)
            try values.encode(name, forKey: .provider)
            try values.encode(id, forKey: .id)
        case .custom(let id):
            try values.encode("custom", forKey: .kind)
            try values.encode(id, forKey: .id)
        }
    }
}
