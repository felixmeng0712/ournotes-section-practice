#!/bin/bash
# Double-click on a Mac: builds the app and installs it on the iPhone connected by cable.
# Apps signed with a free Apple ID stop opening after 7 days; double-click again to renew (songs you downloaded stay).
# Team ID and bundle ID come from project.yml.
set -e
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="/opt/homebrew/bin:$PATH"
BUILD="$HOME/Library/Caches/ournotes-practice-build"
done_() { read -n 1 -s -r -p "Press any key to close"; exit "$1"; }

if grep -qE '^ *DEVELOPMENT_TEAM: *""' project.yml; then
  echo "Set DEVELOPMENT_TEAM in ios/project.yml to your Apple team ID first (Xcode › Settings › Accounts)."
  done_ 1
fi
BUNDLE_ID=$(sed -n 's/^ *PRODUCT_BUNDLE_IDENTIFIER: *\([^ #]*\).*/\1/p' project.yml | head -1)

UDID=$(xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null | python3 -c '
import json, sys
text = sys.stdin.read()
devs = json.loads(text[text.index("{"):])["result"]["devices"]
for d in devs:
    hw = d.get("hardwareProperties", {})
    if hw.get("platform") == "iOS" and hw.get("reality") == "physical" and d.get("connectionProperties", {}).get("pairingState") == "paired":
        print(hw["udid"]); break
')
if [ -z "$UDID" ]; then
  echo "No iPhone found: connect it to the Mac with a cable, unlock it, tap Trust, and try again."
  done_ 1
fi

echo "Building (about a minute the first time)…"
xcodegen generate -q
xcodebuild -project OurNotesPractice.xcodeproj -scheme OurNotesPractice -configuration Release \
  -destination "id=$UDID" -derivedDataPath "$BUILD" -allowProvisioningUpdates -quiet build

echo "Installing…"
xcrun devicectl device install app --device "$UDID" "$BUILD/Build/Products/Release-iphoneos/OurNotesPractice.app" >/dev/null
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || \
  echo "Installed. The first time, trust your developer certificate on the iPhone under Settings › General › VPN & Device Management, then open the app."
echo "Done."
done_ 0
