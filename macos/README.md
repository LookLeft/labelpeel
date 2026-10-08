# Labelpeel for Mac

A small native app around the web app. It shows the same app in a WebKit view
and adds a printer bridge:

- **Bluetooth:** connects straight to the paired printer with IOBluetooth, so
  connecting fails properly when the printer is off, unlike a browser, which
  can only open the `cu.` serial port macOS keeps for every paired device.
- **USB:** opens the printer's USB printer interface with IOUSBHost (WebKit has
  no WebUSB).

## Installing

Download `Labelpeel-<version>.dmg` from the [latest release](../../../releases/latest),
open it and drag Labelpeel to Applications.

## Printing

- **Bluetooth:** pair the printer in System Settings → Bluetooth (it's normal
  for it to show "Not Connected" there), then click **Bluetooth printer** and
  allow Bluetooth access when asked.
- **USB:** plug the printer in, switch it on and click **USB cable**. Quit
  P-touch Editor first if it's open.

## Building locally

Needs Xcode and XcodeGen (`brew install xcodegen`).

```sh
macos/build-web.sh   # builds the web app into the app and generates the Xcode project
open macos/LabelpeelMac.xcodeproj
```

Safari → Develop → Labelpeel opens the web inspector.

## Releases: signing and notarization

The **Release** workflow builds the app on GitHub, signs it with your Developer
ID certificate, notarizes it with Apple and attaches the `.dmg` to the release.
Set up the secrets once:

1. **Certificate request:** `scripts/macos-signing.sh csr` creates a private
   key and `secrets/developer-id.csr`.
2. **Certificate:** at [developer.apple.com → Certificates](https://developer.apple.com/account/resources/certificates/add),
   add a **Developer ID Application** certificate (G2 Sub-CA), upload the
   `.csr`, and save the downloaded `.cer` in `secrets/`.
3. **Notarization key:** in [App Store Connect → Users and Access → Integrations → Team Keys](https://appstoreconnect.apple.com/access/integrations/api),
   create a key with **Developer** access. Download the `AuthKey_XXXXXXXXXX.p8`
   (only possible once) into `secrets/`, and note the **Issuer ID** at the top
   of the page.
4. **Secrets file:** `scripts/macos-signing.sh env <issuer-id>` writes
   `secrets/macos-signing.env`.
5. **GitHub:** add each line of that file as a repository secret
   (Settings → Secrets and variables → Actions): `MACOS_CERTIFICATE_BASE64`,
   `MACOS_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID` and
   `APPLE_API_ISSUER_ID`.
6. **Update key:** add `SPARKLE_PRIVATE_KEY` from the same file as a secret too
   (see [Updates](#updates)).

Back up `secrets/` somewhere safe, such as a password manager. Without the
secrets, release builds still publish a `.dmg`, but it's unsigned and macOS
warns that it can't check it.

## Updates

The app updates itself with [Sparkle](https://sparkle-project.org). It checks
`appcast.xml` on the latest GitHub release once a day (and on demand from
**Labelpeel → Check for Updates…**). When a newer version is there, it offers
to download the `.dmg`, checks it was signed with the update key and replaces
the app.

The Release workflow writes `appcast.xml` and attaches it to each release. It
signs the `.dmg` with the private EdDSA key in the `SPARKLE_PRIVATE_KEY`
secret; the app only accepts updates signed with the matching public key
(`SUPublicEDKey` in `project.yml`). Keep `secrets/sparkle-private.key` backed
up: if it's lost, installed copies can't be updated automatically, and people
have to download a build with a new public key by hand.

To make a new key pair, download a [Sparkle release](https://github.com/sparkle-project/Sparkle/releases)
and run `bin/generate_keys -x secrets/sparkle-private.key`, then put the
printed public key in `project.yml`.

If the secret isn't set, the release has no `appcast.xml`, and installed
copies don't see it.
