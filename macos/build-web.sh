#!/bin/sh
# Builds the web app, copies it into the macOS app, and regenerates the Xcode
# project. Run again after changing the web app.
set -e
cd "$(dirname "$0")/.."
npm run build
rm -rf macos/Web
cp -R dist macos/Web
cd macos
if command -v xcodegen >/dev/null 2>&1; then
  xcodegen
else
  echo "Install XcodeGen (brew install xcodegen), then run: cd macos && xcodegen"
  exit 1
fi
echo "Done. Open macos/LabelpeelMac.xcodeproj in Xcode, or build from the command line:"
echo "  xcodebuild -project macos/LabelpeelMac.xcodeproj -scheme Labelpeel -configuration Release build"
