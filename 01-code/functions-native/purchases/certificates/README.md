# Apple trust roots

Public DER certificates, not private keys. Downloaded from Apple's PKI page:
https://www.apple.com/certificateauthority/

- https://www.apple.com/certificateauthority/AppleRootCA-G2.cer
- https://www.apple.com/certificateauthority/AppleRootCA-G3.cer

The verifier uses these trust anchors with online revocation checks. Never add an
Xcode/local testing certificate here or disable live signature verification.
