#!/bin/sh
set -eu
registration="$SRCROOT/BarkRanger/GoogleService-Info.plist"
if [ ! -f "$registration" ]; then
    if [ "$CONFIGURATION" = Release ]; then
        echo 'error: Download the bark-ranger-ios Firebase registration before building Release.'
        exit 1
    fi
    echo 'warning: Native Firebase registration is missing; only isolated local tests and public discovery are available.'
    exit 0
fi
project=$(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' "$registration")
app=$(/usr/libexec/PlistBuddy -c 'Print :GOOGLE_APP_ID' "$registration")
bundle=$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$registration")
if [ "$project" != bark-ranger-ios ] || [ "$app" != '1:360077919845:ios:cd94b1ea6899f95da6e88c' ] || [ "$bundle" != "$PRODUCT_BUNDLE_IDENTIFIER" ]; then
    echo 'error: Firebase configuration must match the exact bark-ranger-ios iOS registration. Never use the old project.'
    exit 1
fi
