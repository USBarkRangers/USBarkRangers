// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BarkDomain",
    products: [.library(name: "BarkDomain", targets: ["BarkDomain"])],
    targets: [
        .target(name: "BarkDomain"),
        .testTarget(name: "BarkDomainTests", dependencies: ["BarkDomain"])
    ],
    swiftLanguageModes: [.v6]
)
