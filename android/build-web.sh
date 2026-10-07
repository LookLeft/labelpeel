#!/bin/sh
# Builds the web app and copies it into the Android app's assets.
# Run again after changing the web app, then build with Gradle:
#   cd android && gradle assembleDebug
set -e
cd "$(dirname "$0")/.."
npm run build
rm -rf android/app/src/main/assets/web
mkdir -p android/app/src/main/assets
cp -R dist android/app/src/main/assets/web
echo "Done. Build the APK with: cd android && gradle assembleDebug"
