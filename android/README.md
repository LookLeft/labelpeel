# Labelsmith for Android

A small native app around the web app. It shows the same app in a WebView and
adds a Bluetooth bridge: Android apps can talk to Bluetooth Classic printers
like the PT-E560BT over the Serial Port Profile. Unlike iOS, this needs no
approval from Brother.

## Installing

Download `labelsmith-<version>.apk` from the
[latest release](../../../releases/latest) on your phone and open it. Android
asks you to allow installing apps from your browser or Files app the first time.

Builds of every push are also attached to the **Android** workflow runs in the
Actions tab, as the `labelsmith-android` artifact (a zip containing the APK).

## Printing

1. Pair the printer in **Settings → Bluetooth** (or **Connected devices**).
2. In the app, open the printer panel and tap **Bluetooth printer**. Allow
   **Nearby devices** when asked.
3. If several Brother printers are paired, choose one from the list.

The printer accepts one Bluetooth connection at a time, so disconnect it from
other phones and apps first.

For **USB**, connect the printer with a cable (most phones need a USB-C OTG
adapter or cable), switch it on, tap **USB cable** and allow access when
Android asks.

## Building locally

Needs JDK 17, Gradle 8.11+ (`brew install openjdk@17 gradle`) and the Android
SDK (Android Studio installs it; set `ANDROID_HOME` or add `sdk.dir` to
`android/local.properties`).

```sh
android/build-web.sh                  # build the web app into the app's assets
cd android && gradle assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or open the `android` folder in Android Studio after running `build-web.sh`.
`chrome://inspect` on a computer can debug the page in a debug build.

## Releases and signing

The **Release** workflow (Actions tab → Release → Run workflow, or push a tag
like `v1.2.0`) builds the APK and publishes a GitHub release with it attached.

Android only installs an update when it's signed with the same key as the
installed copy, so set up a release key once:

```sh
keytool -genkeypair -v -keystore labelsmith.keystore -alias labelsmith \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -i labelsmith.keystore | pbcopy   # macOS; on Linux: base64 -w0 labelsmith.keystore
```

Then add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 text copied above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `labelsmith` |
| `ANDROID_KEY_PASSWORD` | the key password (the same as the keystore password unless you chose another) |

Keep the keystore file and passwords somewhere safe: without them you can't
publish updates that install over existing copies. Without the secrets, builds
are signed with a temporary debug key and show a warning in the workflow run.
