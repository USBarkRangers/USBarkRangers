import Foundation

/// Native account metadata only. Trips, visits, activities and journal content have independent rows.
public struct NativeProfile: Codable, Equatable, Sendable {
    public enum MapStyle: String, Codable, Sendable { case `default`, satellite }
    public enum Status: String, Codable, Sendable { case active, deleting }
    public let schemaVersion: Int
    public let revision: Int64
    public var displayName: String
    public var mapStyle: MapStyle
    public let status: Status

    public init(
        revision: Int64, displayName: String, mapStyle: MapStyle = .default,
        status: Status = .active, schemaVersion: Int = 1
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.displayName = displayName
        self.mapStyle = mapStyle
        self.status = status
    }

    public func validate() throws {
        guard schemaVersion == 1, (1...9_007_199_254_740_991).contains(revision) else {
            throw NativeProfileEdit.Failure.invalid
        }
        try NativeProfileEdit.displayName(displayName).validate()
    }
}

public enum NativeProfileEdit: Codable, Equatable, Sendable {
    public enum Failure: Error { case invalid }
    case bootstrap
    case displayName(String)
    case mapStyle(NativeProfile.MapStyle)

    public var commandKind: String {
        switch self {
        case .bootstrap: "bootstrapAccount"
        case .displayName: "updateProfile"
        case .mapStyle: "updateMapStyle"
        }
    }

    public func validate() throws {
        if case .displayName(let name) = self {
            guard (2...30).contains(name.utf16.count),
                name == name.trimmingCharacters(in: .whitespacesAndNewlines),
                !name.contains("<"), !name.contains(">"),
                !name.unicodeScalars.contains(where: {
                    $0.properties.generalCategory == .control || $0.properties.generalCategory == .format
                })
            else { throw Failure.invalid }
        }
    }

    public func applying(to profile: NativeProfile) -> NativeProfile {
        var next = profile
        switch self {
        case .bootstrap: break
        case .displayName(let name): next.displayName = name
        case .mapStyle(let style): next.mapStyle = style
        }
        return next
    }
}
