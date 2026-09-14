import Foundation

/// Versioned existing virtual trails. Geometry belongs to the app's bundled TrailRepository.
public struct Trail: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let meters: Double
    public static func bundled() throws -> [Trail] { try definitions.get() }
    // Immutable bundle metadata is decoded once, including during optimistic queue replay.
    private static let definitions: Result<[Trail], any Error> = Result {
        guard let url = Bundle.module.url(forResource: "trails", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode([Trail].self, from: Data(contentsOf: url))
    }
}
