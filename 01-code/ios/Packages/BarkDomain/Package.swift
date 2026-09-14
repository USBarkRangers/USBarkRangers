// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BarkDomain",
    platforms: [.iOS(.v18), .macOS(.v13)],
    products: [.library(name: "BarkDomain", targets: ["BarkDomain"])],
    targets: [
        .target(name: "BarkDomain", resources: [.process("Resources")]),
        .testTarget(name: "BarkDomainTests", dependencies: ["BarkDomain"], resources: [.process("Fixtures")]),
    ],
    swiftLanguageModes: [.v6]
)
