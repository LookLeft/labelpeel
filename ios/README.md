# Labelsmith for iPhone and iPad

A small native wrapper around the web app. It shows the same app in a web
view and adds a Bluetooth bridge, because iOS browsers can't reach printers.
iOS lets apps use Bluetooth Classic printers like the PT-E560BT only through
the External Accessory framework, using Brother's `com.brother.ptcbp`
protocol. The web app builds the same print jobs it sends from Chrome.

This is for installing on your own devices from Xcode. Publishing to the App
Store would also need Brother's MFi approval for the accessory protocol.

## Setup (once)

1. Install Xcode and XcodeGen: `brew install xcodegen`
2. From the repo root: `npm install`, then `ios/build-web.sh`
   (builds the web app, copies it to `ios/Web`, generates `ios/Labelsmith.xcodeproj`).
3. Open `ios/Labelsmith.xcodeproj`. The signing team is set in `ios/project.yml`
   (`DEVELOPMENT_TEAM`); if you're building from a fork, change it there (and
   the bundle ID if it's taken), then run `ios/build-web.sh` again.
4. Plug in your iPhone (Developer Mode on), choose it as the run destination, and press Run.
   The first time, trust the developer certificate in Settings > General > VPN & Device Management.

Builds installed from Xcode stop opening after 7 days with a free Apple account, or a year with a paid developer account; press Run again to reinstall.

## Printing

Turn the printer on and disconnect it from any other phone or app. In the
app, open the printer panel and tap **Bluetooth printer**. If the printer
isn't paired yet, iOS shows its pairing sheet.

## Updating

After changing the web app, run `ios/build-web.sh` again and rebuild in Xcode.

## Debugging

On the Mac, Safari > Develop > (your iPhone) > Labelsmith opens the web
inspector for the app, including the printer log.
