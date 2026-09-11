#!/usr/bin/env python3
"""Run opt-in native Firebase/Account UI contracts after a signed build-for-testing.

Requires the dedicated demo-barkranger-ios emulators and seeded synthetic accounts.
Only a temporary xctestrun copy is changed; the ordinary scheme stays isolated.
"""
import argparse
import pathlib
import plistlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--products", required=True, type=pathlib.Path)
parser.add_argument("--destination", required=True)
args = parser.parse_args()
products = args.products.resolve()
candidates = list(products.glob("BarkRanger_iphonesimulator*.xctestrun"))
if len(candidates) != 1:
    parser.error("Expected one BarkRanger simulator xctestrun; run build-for-testing first.")
with candidates[0].open("rb") as source:
    settings = plistlib.load(source)
for target in ("BarkRangerTests", "BarkRangerUITests"):
    settings[target].setdefault("EnvironmentVariables", {})["BARK_RUN_ACCOUNT_EMULATOR_TESTS"] = "1"
copy = products / "BarkPhase3Accounts.xctestrun"
try:
    with copy.open("wb") as output:
        plistlib.dump(settings, output)
    subprocess.run([
        "xcodebuild", "-xctestrun", str(copy), "-destination", args.destination,
        "-parallel-testing-enabled", "NO", "-only-testing:BarkRangerTests/NativeAccountEmulatorTests",
        "-only-testing:BarkRangerUITests/AccountUITests", "test-without-building",
    ], check=True)
finally:
    copy.unlink(missing_ok=True)
