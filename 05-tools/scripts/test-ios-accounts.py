#!/usr/bin/env python3
"""Run opt-in native Firebase/Account UI contracts after a signed build-for-testing.

Requires the isolated demo-bark-native emulators and seeded synthetic accounts.
Defaults to --native-profile. No retired web-database test path remains.
Only a temporary xctestrun copy is changed; the ordinary scheme stays isolated.
"""
import argparse
import datetime
import json
import os
import pathlib
import plistlib
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--products", required=True, type=pathlib.Path)
parser.add_argument("--destination", required=True)
parser.add_argument("--native-profile", action="store_true", help="Native account/profile checks; requires demo-bark-native loopback emulators and seed-native-profile-ui.cjs")
parser.add_argument("--native-trips", action="store_true", help="Native trip/map checkpoint; same isolated emulators and account seed")
parser.add_argument("--native-adventures", action="store_true", help="Native visits/walks/progress checkpoint; isolated demo-bark-native emulators")
parser.add_argument("--native-cloud-fixture", type=pathlib.Path, help="Explicit live acceptance using a private, unexpired disposable QA fixture")
parser.add_argument("--only-testing", action="append", help="Run a named test/suite from the selected checkpoint instead of its entire set")
parser.add_argument("--host", default="127.0.0.1", help="Mac's private IPv4 address for physical-device tests")
parser.add_argument("--functional-only", action="store_true", help="Skip the automated accessibility audit; keep account and largest-text interaction checks")
args = parser.parse_args()
if not (args.native_profile or args.native_trips or args.native_adventures or args.native_cloud_fixture):
    args.native_profile = True
if args.native_cloud_fixture and (args.native_profile or args.native_trips or args.native_adventures):
    parser.error("Live acceptance cannot be combined with emulator checkpoints")
products = args.products.resolve()
platform = "iphoneos" if "platform=iOS," in args.destination else "iphonesimulator"
candidates = list(products.glob(f"BarkRanger_{platform}*.xctestrun"))
if len(candidates) != 1:
    parser.error("Expected one BarkRanger xctestrun for this platform; run build-for-testing first.")
with candidates[0].open("rb") as source:
    settings = plistlib.load(source)
for target in ("BarkRangerTests", "BarkRangerUITests"):
    flag = "BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS"
    settings[target].setdefault("EnvironmentVariables", {})[flag] = "1"
    settings[target]["EnvironmentVariables"]["BARK_EMULATOR_HOST"] = args.host
    if args.functional_only:
        settings[target]["EnvironmentVariables"]["BARK_ACCOUNT_FUNCTIONAL_ONLY"] = "1"
copy = products / ("BarkNativeAdventures.xctestrun" if args.native_adventures else "BarkNativeTrips.xctestrun" if args.native_trips else "BarkNativeProfile.xctestrun")
if (args.native_profile or args.native_trips or args.native_adventures) and (args.host != "127.0.0.1" or platform != "iphonesimulator"):
    parser.error("Native profile UI fixtures are simulator/loopback only; physical acceptance is separate.")
tests = [
    "BarkRangerTests/NativeAccountFeatureEmulatorTests", "BarkRangerTests/NativeProfileEmulatorTests",
    "BarkRangerTests/NativeProfileEdgeTests", "BarkRangerTests/NativeStoreTests",
    "BarkRangerTests/NativeSyncJobsTests", "BarkRangerTests/AccountActionTests",
    "BarkRangerTests/AccountIsolationTests", "BarkRangerTests/ScopedSettingsTests",
    "BarkRangerTests/CorrectnessPolicyTests", "BarkRangerTests/NativePendingChangesTests",
    "BarkRangerTests/NativeMailroomTests", "BarkRangerTests/NativeCacheRetentionTests",
    "BarkRangerTests/AccountDiagnosticsTests", "BarkRangerUITests/NativeAccountUITests",
    "BarkRangerTests/NativeAccountDeletionTests",
]
if not args.native_profile:
    tests = []
if args.native_trips:
    tests += [
        "BarkRangerTests/NativeTripFeatureEmulatorTests", "BarkRangerTests/NativeTripEmulatorTests",
        "BarkRangerTests/NativeTripStoreTests", "BarkRangerTests/NativeTripReconciliationTests",
        "BarkRangerTests/NativeTripIdentityTests",
        "BarkRangerTests/NativeTripCostTests",
        "BarkRangerTests/AccessStabilizationTests", "BarkRangerTests/AccountIsolationTests",
        "BarkRangerTests/CorrectnessPolicyTests", "BarkRangerTests/MapColorProjectionTests",
        "BarkRangerTests/NativeCacheRetentionTests", "BarkRangerTests/TripLibraryPagingTests",
        "BarkRangerTests/NativeSavedPinTests", "BarkRangerTests/NativeSavedPinEmulatorTests",
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
    tests += [
        "BarkRangerTests/NativeVisitActionTests", "BarkRangerTests/NativeVisitQueueTests",
        "BarkRangerTests/NativeVisitConflictTests", "BarkRangerTests/NativeVisitOutboxEmulatorTests",
        "BarkRangerTests/NativeVisitEmulatorTests", "BarkRangerTests/PendingVisitMarkerTests",
        "BarkRangerTests/NativeExpeditionWireEmulatorTests", "BarkRangerTests/NativeActivityReconciliationTests",
        "BarkRangerTests/NativeAdventureFeatureEmulatorTests", "BarkRangerTests/NativeAdventureCostTests",
        "BarkRangerTests/NativeExpeditionRecoveryTests", "BarkRangerTests/NativeLeaderboardFeatureTests",
        "BarkRangerTests/WalkRecorderTests", "BarkRangerTests/RecordingStoreTests",
        "BarkRangerTests/PassportConsistencyTests", "BarkRangerTests/PassportNavigationTests",
        "BarkRangerTests/LeaderboardTests", "BarkRangerTests/SharingAndFeedbackTests",
        "BarkRangerTests/MapColorProjectionTests", "BarkRangerTests/NativeSyncJobsTests",
        "BarkRangerUITests/NativeAdventureUITests",
    ]
# Multiple checkpoints form a union, not last-flag-wins or repeated UI launches.
tests = list(dict.fromkeys(tests))
if args.native_cloud_fixture:
    with args.native_cloud_fixture.open() as source:
        fixture = json.load(source)
    if (fixture.get("project") != "bark-ranger-ios"
            or not fixture.get("email", "").startswith("cloud-acceptance-")
            or not fixture.get("email", "").endswith("@native.invalid")
            or datetime.datetime.fromisoformat(fixture["expiresAt"].replace("Z", "+00:00"))
            <= datetime.datetime.now(datetime.timezone.utc)):
        parser.error("An unexpired, disposable bark-ranger-ios QA fixture is required")
    for target in ("BarkRangerTests", "BarkRangerUITests"):
        environment = settings[target].setdefault("EnvironmentVariables", {})
        for key in ("BARK_RUN_ACCOUNT_EMULATOR_TESTS", "BARK_RUN_NATIVE_PROFILE_EMULATOR_TESTS", "BARK_EMULATOR_HOST"):
            environment.pop(key, None)
    settings["BarkRangerTests"]["EnvironmentVariables"].update({
        "BARK_RUN_NATIVE_CLOUD_ACCEPTANCE": "1",
        "BARK_CLOUD_TEST_EMAIL": fixture["email"], "BARK_CLOUD_TEST_PASSWORD": fixture["password"],
        "BARK_CLOUD_TEST_UID": fixture["uid"], "AppCheckDebugToken": fixture["debugToken"],
    })
    copy = products / "BarkNativeCloud.xctestrun"
    tests = ["BarkRangerTests/NativeCloudAcceptanceTests"]
if args.only_testing:
    if not all(any(item == suite or item.startswith(suite + "/") for suite in tests) for item in args.only_testing):
        parser.error("Requested test must belong to the selected checkpoint")
    tests = args.only_testing
try:
    # Live fixtures contain short-lived QA credentials; never create a world-readable manifest.
    descriptor = os.open(copy, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        plistlib.dump(settings, output)
    # CI must retain the native result too, including failures before the shell suite.
    # Never place credential-bearing live acceptance artifacts in the upload directory.
    result = pathlib.Path(tempfile.mkdtemp(prefix="BarkAccountChecks-",
        dir=os.environ.get("RUNNER_TEMP") if not args.native_cloud_fixture else None)) / "Acceptance.xcresult"
    execution = subprocess.run([
        "xcodebuild", "-xctestrun", str(copy), "-destination", args.destination,
        "-resultBundlePath", str(result),
        "-parallel-testing-enabled", "NO", *[f"-only-testing:{test}" for test in tests],
        "test-without-building", "-quiet",
    ], check=False)
    summary = json.loads(subprocess.check_output([
        "xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result),
    ], text=True))
    if execution.returncode != 0:
        print(json.dumps(summary.get("testFailures", []), indent=2), flush=True)
    if (execution.returncode != 0 or summary.get("passedTests", 0) < 1 or summary.get("failedTests", 0) > 0
            or (args.native_cloud_fixture and summary.get("skippedTests", 0) > 0)):
        raise RuntimeError(f"No passing selected checks, a failure, or skipped cloud acceptance: {result}")
    print(f"Verified {summary['passedTests']} passed checks. Evidence: {result}")
finally:
    copy.unlink(missing_ok=True)
