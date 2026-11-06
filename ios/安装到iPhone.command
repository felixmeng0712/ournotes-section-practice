#!/bin/bash
# 双击：重新编译并安装到用数据线连着的 iPhone。
# 免费 Apple ID 签名的 app 7 天后打不开，到时再双击一次即可（覆盖安装，下载过的歌都还在）。
set -e
cd "$(dirname "$0")"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="/opt/homebrew/bin:$PATH"
BUILD="$HOME/Library/Caches/ournotes-practice-build"

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
  echo "没找到 iPhone：用数据线连上 Mac，解锁手机，点「信任」后再试。"
  read -n 1 -s -r -p "按任意键关闭"; exit 1
fi

echo "编译中（第一次约 1 分钟）…"
xcodegen generate -q
xcodebuild -project OurNotesPractice.xcodeproj -scheme OurNotesPractice -configuration Release \
  -destination "id=$UDID" -derivedDataPath "$BUILD" -allowProvisioningUpdates -quiet build

echo "安装到手机…"
xcrun devicectl device install app --device "$UDID" "$BUILD/Build/Products/Release-iphoneos/OurNotesPractice.app" >/dev/null
xcrun devicectl device process launch --device "$UDID" com.example.ournotes.practice >/dev/null 2>&1 || \
  echo "已安装。第一次装的话，要先在 iPhone 的 设置 ▸ 通用 ▸ VPN 与设备管理 里信任你的开发者证书，再打开 app。"
echo "完成。"
read -n 1 -s -r -p "按任意键关闭"
