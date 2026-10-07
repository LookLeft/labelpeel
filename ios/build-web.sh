#!/bin/sh
# Builds the web app, copies it into the iOS app, and regenerates the Xcode
# project. Run again after changing the web app.
set -e
cd "$(dirname "$0")/.."
npm run build
rm -rf ios/Web
cp -R dist ios/Web
cd ios
if command -v xcodegen >/dev/null 2>&1; then
  xcodegen
else
  echo "Install XcodeGen (brew install xcodegen), then run: cd ios && xcodegen"
  exit 1
fi
echo "Done. Open ios/PtouchStudio.xcodeproj in Xcode."
