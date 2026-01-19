# FigCap 配布パッケージ README（Chrome拡張B + FigmaプラグインC）

## 同梱物
- `figcap-extension/` … Chrome拡張B（Manifest v3, サイドパネル）
- `figcap-figma-plugin/` … FigmaプラグインC（JSON→Figma再構築）
- `Doc/ChromeExtention.md` … 拡張B 仕様ドキュメント（最新版）
- `Doc/FigmaPlugin.txt` … プラグインC 仕様ドキュメント（最新版）
- `README_Distribution.md` … 本ファイル

## 前提
- Chrome（拡張機能のデベロッパーモードが使える環境）
- Figma デスクトップアプリ（Mac/Windows）

## Chrome拡張Bの導入手順
1. ZIPを展開し、`figcap-extension` フォルダを任意の場所に置く（パスは固定不要）。
2. Chromeを開き、`chrome://extensions` → 右上「デベロッパーモード」をON。
3. 「パッケージ化されていない拡張機能を読み込む」→ `figcap-extension` フォルダを選択。
4. 以後、拡張アイコン（サイドパネル）が利用可能。

## FigmaプラグインCの導入手順
1. ZIPを展開し、`figcap-figma-plugin` フォルダを任意の場所に置く。
2. Figmaデスクトップアプリを開く。
3. `Plugins` → `Development` → `Import plugin from manifest...` を選択。
4. `figcap-figma-plugin/manifest.json` を指定してインポート。
5. `Plugins` → `Development` から `FigCap C (JSON -> Figma)` を起動。

## 使い方の流れ（概要）
1. Chrome拡張B（サイドパネル）でページを `Scan` → 抽出したい要素にチェック → `Capture` → JSONを保存。
2. FigmaでプラグインCを起動し、保存したJSONを `Import File` または貼り付けで取り込む。
3. オプション：
   - `Preserve position` ONで元の座標を維持 / OFFで縦積み配置。
   - `Auto text width` はデフォルトON（幅の自動調整）。

## ZIPパッケージの作り方（配布者向け）
リポジトリ直下で以下を実行（PowerShell想定）：

```powershell
Compress-Archive `
  -Path figcap-extension, figcap-figma-plugin, Doc/ChromeExtention.md, Doc/FigmaPlugin.txt, README_Distribution.md `
  -DestinationPath FigCap_Package.zip `
  -Force
```

`FigCap_Package.zip` を配布すれば、展開後すぐに上記手順で導入できます。***
