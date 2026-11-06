# Section Practice

An unofficial practice tool for the rhythm game *BanG Dream! Our Notes*: pick a song, pick a few bars, and play just that passage on a loop, slowed down if you like, with a breakdown of what makes it hard and which hand should play each note.

Runs in a desktop or phone browser, or as an iOS app. English and Simplified Chinese (Settings › Language).

> Fan-made and not affiliated with or endorsed by the game's developers or publishers. *BanG Dream!* and related names belong to their owners. No game files are included in this repository.

## What it does

- **Section loop**: choose a range of bars on a density timeline, or jump to the hardest passages it finds; auto repeat restarts the section as soon as it ends.
- **Slow drill**: starts at 70% speed and goes up 5% after each steady run, down after a messy one.
- **How to play**: suggests a left/right hand split (two thumbs, alternating, few crossings), colours the chart by hand, and explains streams, chords, jumps, holds with taps and other patterns in the section. Practise one hand while the other is played for you.
- **History**: every run's judgements, early/late average and the notes you keep missing, with an offset suggestion.
- **Game-accurate timing**: judgement windows and note speed follow the game's own values.
- **Offline**: songs are cached after the first load; Download all caches everything.

## Running it

Charts and music are loaded from [bdon.yatta.moe](https://bdon.yatta.moe) through a small local proxy that also caches them.

**Mac / PC (browser)**

```bash
python3 server.py --port 8000
```

Then open <http://localhost:8000>. Phones and tablets on the same Wi-Fi can open `http://<your computer's IP>:8000`. On a Mac, double-clicking `启动练习器.command` does the same.

**iPhone / iPad (app)**

Needs a Mac with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

1. In `ios/project.yml`, set `DEVELOPMENT_TEAM` to your Apple team ID (a free Apple ID works) and change `bundleIdPrefix` / `PRODUCT_BUNDLE_IDENTIFIER` to something of your own. Use the same bundle ID in `ios/安装到iPhone.command`.
2. Connect the phone, unlock it, and double-click `ios/安装到iPhone.command` (or run `xcodegen generate` and build `ios/OurNotesPractice.xcodeproj` in Xcode).
3. The first time, trust your developer certificate on the phone under Settings › General › VPN & Device Management. Apps signed with a free Apple ID stop opening after 7 days; reinstall to renew.

The app bundles the same web app and proxies yatta itself, so no computer is needed once it is installed.

## Optional: your own game textures

If a `web/official/` folder exists, the app uses the textures and hit sounds in it (judgement words, combo digits, lane, hit effects, note skin); without it, it draws these itself and uses yatta's default hit sounds. These files are not distributed here.

## Tests

```bash
cd tests && npm install
sh regress.sh   # needs server.py on port 8765 and Google Chrome
```

A bot plays whole charts with perfect timing; every line should end with `"m":0,"gr":0` and an empty error list.

## Credits

- Charts, music, stage backgrounds, the fallback note skin and hit sounds: [bdon.yatta.moe](https://bdon.yatta.moe). The note-skin assembly and some play-view constants follow the yatta simulator.
- [ogg-opus-decoder](https://github.com/eshaz/wasm-audio-decoders) (MIT) for Opus on Safari.
- [Barlow](https://github.com/jpt/barlow) fonts (SIL Open Font License 1.1).

## Licence

The code in this repository is MIT licensed (see `LICENSE`). That covers only this project's own code, not game content or anything loaded from yatta.

---

## 中文简介

《BanG Dream! Our Notes》的非官方段落练习器：选歌、选几个小节，只反复练这一段，可以减速。会分析这一段难在哪、每个音符建议用哪只手。支持浏览器和 iOS App，设置里可以切换中英文。

运行：`python3 server.py --port 8000` 后打开 <http://localhost:8000>；iOS 版见上面的步骤。仓库不包含任何游戏文件；谱面和音乐来自 bdon.yatta.moe。
