#!/bin/sh
# Sets up signing and notarization for the macOS release build. Everything is
# written to secrets/ (gitignored); add the values from secrets/macos-signing.env
# to the repository's Actions secrets.
#
#   scripts/macos-signing.sh csr
#       Creates a private key and a certificate signing request.
#       Upload secrets/developer-id.csr at developer.apple.com → Certificates →
#       + → Developer ID Application, then download the certificate into
#       secrets/ (it's named developerID_application.cer).
#
#   scripts/macos-signing.sh env <issuer-id>
#       Builds the .p12 from the key and certificate, and writes
#       secrets/macos-signing.env. Put the App Store Connect API key
#       (AuthKey_XXXXXXXXXX.p8, from App Store Connect → Users and Access →
#       Integrations → Team Keys, Developer access) in secrets/ first, and pass
#       the Issuer ID shown on that page.
set -e
cd "$(dirname "$0")/.."
mkdir -p secrets
umask 077
OPENSSL=$(command -v /opt/homebrew/bin/openssl || command -v openssl)

case "$1" in
  csr)
    if [ -f secrets/developer-id.key ]; then
      echo "secrets/developer-id.key already exists; delete it first to start again." >&2
      exit 1
    fi
    "$OPENSSL" req -new -newkey rsa:2048 -nodes \
      -keyout secrets/developer-id.key -out secrets/developer-id.csr \
      -subj "/CN=Labelsmith Developer ID/O=Labelsmith"
    echo "Created secrets/developer-id.csr. Upload it as a Developer ID Application certificate"
    echo "(G2 Sub-CA) at https://developer.apple.com/account/resources/certificates/add"
    echo "and save the downloaded .cer in secrets/."
    ;;
  env)
    ISSUER="$2"
    CER=$(ls secrets/*.cer 2>/dev/null | head -1)
    KEY_FILE=$(ls secrets/AuthKey_*.p8 2>/dev/null | head -1)
    [ -n "$CER" ] || { echo "No .cer in secrets/. Download the Developer ID Application certificate first." >&2; exit 1; }
    [ -f secrets/developer-id.key ] || { echo "secrets/developer-id.key is missing; run: $0 csr" >&2; exit 1; }
    [ -n "$KEY_FILE" ] || { echo "No AuthKey_*.p8 in secrets/. Create an App Store Connect API key first." >&2; exit 1; }
    [ -n "$ISSUER" ] || { echo "Pass the App Store Connect Issuer ID: $0 env <issuer-id>" >&2; exit 1; }

    PW=$("$OPENSSL" rand -base64 48 | tr -d '/+=\n' | cut -c1-40)
    "$OPENSSL" x509 -inform DER -in "$CER" -out secrets/developer-id.pem 2>/dev/null || cp "$CER" secrets/developer-id.pem
    # 3DES/SHA-1 so macOS's `security import` accepts it.
    "$OPENSSL" pkcs12 -export -inkey secrets/developer-id.key -in secrets/developer-id.pem \
      -name "Developer ID Application" -out secrets/developer-id.p12 -passout "pass:$PW" \
      -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
    KEY_ID=$(basename "$KEY_FILE" .p8 | sed 's/^AuthKey_//')
    cat > secrets/macos-signing.env <<EOF
# macOS signing and notarization for Labelsmith. Keep secrets/ private and
# backed up. Add each value as a repository secret on GitHub:
#   Settings → Secrets and variables → Actions → New repository secret
MACOS_CERTIFICATE_BASE64=$(base64 -i secrets/developer-id.p12 | tr -d '\n')
MACOS_CERTIFICATE_PASSWORD=$PW
APPLE_API_KEY_BASE64=$(base64 -i "$KEY_FILE" | tr -d '\n')
APPLE_API_KEY_ID=$KEY_ID
APPLE_API_ISSUER_ID=$ISSUER
EOF
    echo "Wrote secrets/macos-signing.env:"
    "$OPENSSL" x509 -in secrets/developer-id.pem -noout -subject
    ;;
  *)
    sed -n '2,20p' "$0"
    exit 1
    ;;
esac
