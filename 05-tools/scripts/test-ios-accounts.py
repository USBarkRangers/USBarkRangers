#!/usr/bin/env python3
"""Run opt-in native Firebase/Account UI contracts after a signed build-for-testing.

Requires the dedicated demo-barkranger-ios emulators and seeded synthetic accounts.
Use --native-profile for the iOS-only demo-bark-native account/profile checkpoint.
Only a temporary xctestrun copy is changed; the ordinary scheme stays isolated.
"""
import argparse
import pathlib
import plistlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--products", required=True, type=pathlib.Path)
parser.add_argument("--destination", required=True)
parser.add_argument("--native-profile", action="store_true", help="Native account/profile checks; requires demo-bark-native loopback emulators and seed-native-profile-ui.cjs")
parser.add_argument("--native-trips", action="store_true", help="Native trip/map checkpoint; same isolated emulators and account seed")
parser.add_argument("--native-adventures", action="store_true", help="Native visits/walks/progress checkpoint; isolated demo-bark-native emulators")
parser.add_argument("--only-testing", action="append", help="Run a named test/suite from the selected checkpoint instead of its entire set")
parser.add_argument("--host", default="127.0.0.1", help="Mac's private IPv4 address for physical-device tests")
parser.add_argument("--functional-only", action="store_true", help="Skip the automated accessibility audit; keep account and largest-text interaction checks")
args = parser.parse_args()
products = args.products.resolve()
platform = "iphoneos" if "platform=iOS," in args.destination else "iphonesimulator"
candidates = list(products.glob(f"BarkRanger_{platform}*.xctestrun"))
if len(candidates) != 1:
    parser.error("Expected one BarkRanger xctestrun for this platform; run build-for-testing first.")
with candidates[0].open("rb") as source:
    settings = plistlib.load(source)
for target in ("BarkRangerTests", "BarkRangerUITests"):
    flag = "BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS" if args.native_profile or args.native_trips or args.native_adventures else "BARK_RUN_ACCOUNT_EMULATOR_TESTS"
    settings[target].setdefault("EnvironmentVariables", {})[flag] = "1"
    settings[target]["EnvironmentVariables"]["BARK_EMULATOR_HOST"] = args.host
    if args.functional_only:
        settings[target]["EnvironmentVariables"]["BARK_ACCOUNT_FUNCTIONAL_ONLY"] = "1"
copy = products / ("BarkNativeAdventures.xctestrun" if args.native_adventures else "BarkNativeTrips.xctestrun" if args.native_trips else "BarkNativeProfile.xctestrun" if args.native_profile else "BarkPhase3Accounts.xctestrun")
if (args.native_profile or args.native_trips or args.native_adventures) and (args.host != "127.0.0.1" or platform != "iphonesimulator"):
    parser.error("Native profile UI fixtures are simulator/loopback only; physical acceptance is separate.")
tests = [
    "BarkRangerTests/NativeAccountFeatureEmulatorTests", "BarkRangerTests/NativeProfileEmulatorTests",
    "BarkRangerTests/NativeProfileEdgeTests", "BarkRangerTests/NativeStoreTests",
    "BarkRangerTests/NativeSyncJobsTests", "BarkRangerTests/AccountActionTests",
    "BarkRangerTests/AccountIsolationTests", "BarkRangerTests/ScopedSettingsTests",
    "BarkRangerTests/CorrectnessPolicyTests", "BarkRangerUITests/NativeAccountUITests",
] if args.native_profile else [
    "BarkRangerTests/NativeAccountEmulatorTests", "BarkRangerTests/AppShellTests",
    "BarkRangerUITests/ReadOnlyAccessUITests", "BarkRangerUITests/PassportUITests",
]
if args.native_trips:
    tests = [
        "BarkRangerTests/NativeTripFeatureEmulatorTests", "BarkRangerTests/NativeTripEmulatorTests",
        "BarkRangerTests/NativeTripStoreTests", "BarkRangerTests/NativeTripReconciliationTests",
        "BarkRangerTests/NativeTripIdentityTests",
        "BarkRangerTests/NativeTripCostTests",
        "BarkRangerTests/AccessStabilizationTests", "BarkRangerTests/AccountIsolationTests",
        "BarkRangerTests/CorrectnessPolicyTests", "BarkRangerTests/MapColorProjectionTests",
        "BarkRangerTests/AdventureStoreTests", "BarkRangerTests/TripLibraryPagingTests",
        "BarkRangerTests/NativeDraftHandoffTests", "BarkRangerTests/SavedPlaceStoreTests",
        "BarkRangerTests/SavedPlaceIndexTests", "BarkRangerTests/MapPlaceAnnotationTests",
        "BarkRangerTests/PlannerTargetingTests", "BarkRangerTests/TripDraftSessionTests",
        "BarkRangerTests/ActiveTripSessionTests", "BarkRangerTests/TripManagementTests",
        "BarkRangerTests/SharedDayControlTests", "BarkRangerTests/NativeSyncJobsTests",
        "BarkRangerTests/NativeAccountFeatureEmulatorTests",
        "BarkRangerUITests/TripNavigationUITests", "BarkRangerUITests/SavedPlacesUITests",
        "BarkRangerUITests/NativeAccountUITests",
    ]
if args.native_adventures:
    tests = [
        "BarkRangerTests/NativeVisitActionTests", "BarkRangerTests/NativeVisitQueueTests",
        "BarkRangerTests/NativeVisitConflictTests", "BarkRangerTests/NativeVisitOutboxEmulatorTests",
        "BarkRangerTests/NativeVisitEmulatorTests",
        "BarkRangerTests/NativeExpeditionWireEmulatorTests", "BarkRangerTests/NativeActivityReconciliationTests",
        "BarkRangerTests/NativeAdventureFeatureEmulatorTests", "BarkRangerTests/NativeAdventureCostTests",
        "BarkRangerTests/NativeExpeditionRecoveryTests", "BarkRangerTests/NativeLeaderboardFeatureTests",
        "BarkRangerTests/WalkRecorderTests", "BarkRangerTests/RecordingStoreTests",
        "BarkRangerTests/PassportConsistencyTests", "BarkRangerTests/PassportNavigationTests",
        "BarkRangerTests/LeaderboardTests", "BarkRangerTests/SharingAndFeedbackTests",
        "BarkRangerTests/MapColorProjectionTests", "BarkRangerTests/NativeSyncJobsTests",
        "BarkRangerUITests/NativeAdventureUITests",
    ]
if args.only_testing:
    if not all(any(item == suite or item.startswith(suite + "/") for suite in tests) for item in args.only_testing):
        parser.error("Requested test must belong to the selected checkpoint")
    tests = args.only_testing
try:
    with copy.open("wb") as output:
        plistlib.dump(settings, output)
    subprocess.run([
        "xcodebuild", "-xctestrun", str(copy), "-destination", args.destination,
        "-parallel-testing-enabled", "NO", *[f"-only-testing:{test}" for test in tests],
        "test-without-building", "-quiet",
    ], check=True)
finally:
    copy.unlink(missing_ok=True)
