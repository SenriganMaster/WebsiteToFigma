# WebsiteToFigma 開発ToDo

## 📋 概要

このプロジェクトは2つのツールで構成される：
1. **Chrome拡張B (figcap-extension)**: Webページを解析してJSON出力
2. **FigmaプラグインC (figcap-figma-plugin)**: JSONをFigmaに読み込んでFrame/Rect/Text生成

指示書は `Doc/` フォルダに格納済み：
- `Doc/ChromeExtention.md` - Chrome拡張Bの詳細仕様
- `Doc/FigmaPlugin.txt` - FigmaプラグインCの詳細仕様

---

## 🎯 Phase 1: Chrome拡張B（figcap-extension）

### 1.1 ディレクトリ構造作成
- [x] `figcap-extension/` フォルダ作成 (2026-01-17 完了)
- [x] `figcap-extension/sidepanel/` フォルダ作成 (2026-01-17 完了)
- [x] `figcap-extension/content/` フォルダ作成 (2026-01-17 完了)
- [x] `figcap-extension/icons/` フォルダ作成 (2026-01-17 完了)

### 1.2 manifest.json
- [x] `figcap-extension/manifest.json` 作成 (2026-01-17 完了)
  - manifest_version: 3
  - permissions: scripting, sidePanel, debugger, downloads
  - host_permissions: <all_urls>
  - side_panel設定
  - icons設定

### 1.3 Service Worker
- [x] `figcap-extension/service_worker.js` 作成 (2026-01-17 完了)
  - chrome.runtime.onInstalled でサイドパネル動作設定
  - setPanelBehavior({ openPanelOnActionClick: true })

### 1.4 Side Panel UI
- [x] `figcap-extension/sidepanel/sidepanel.html` 作成 (2026-01-17 完了)
  - Scan / Pick / Capture / Clear ボタン
  - 候補リスト表示エリア (#list)
  - タブ情報表示 (#tabInfo)
  - ログ表示 (#log)
- [x] `figcap-extension/sidepanel/sidepanel.css` 作成 (2026-01-17 完了)
  - ボタン行レイアウト
  - 候補リストスタイル
  - ログエリアスタイル（ダークテーマ）

### 1.5 Side Panel ロジック（重要・最大のファイル）
- [x] `figcap-extension/sidepanel/sidepanel.js` 作成 (2026-01-17 完了)
- [x] 候補リストにALL選択を追加 (2026-01-17 完了)
- [x] 画像データURL埋め込み（拡張B+プラグインC） (2026-01-17 完了)
- [x] 画像URLの解決と取得改善 (2026-01-17 完了)
- [x] 画像クリップ取得（CDP） (2026-01-17 完了)
  - 状態管理: currentTabId, candidates, selected, lastScanMeta
  - **ensureContentScript()**: PING確認 → 未注入ならスクリプト注入
  - **btnScan**: FIGCAP_SCAN → 候補リスト描画 → meta保存
  - **btnPick**: FIGCAP_PICK_START → Pickモード開始
  - **btnCapture**: 
    - FIGCAP_MARK → 選択要素にdata-figcap-id付与
    - captureViaCDP() 試行（失敗時→captureViaDOMFallback()）
    - FIGCAP_UNMARK → マーク解除
    - page meta上書き
    - downloadJSON()
  - **btnClear**: ハイライト・マーク・オーバーレイ解除
  - **captureViaCDP()**: 
    - chrome.debugger.attach
    - DOMSnapshot.captureSnapshot
    - buildExportFromSnapshot()
    - chrome.debugger.detach
  - **buildExportFromSnapshot()**: CDPスナップショット→JSON変換
  - **captureViaDOMFallback()**: FIGCAP_CAPTURE_DOM呼び出し
  - **downloadJSON()**: Blob生成 → chrome.downloads.download
  - **renderList()**: 候補リストUI更新
  - chrome.runtime.onMessage (FIGCAP_PICKED受信)

### 1.6 Content Script（ページ側ロジック）
- [x] `figcap-extension/content/contentScript.js` 作成 (2026-01-17 完了)
  - 状態管理: candidates Map, overlayRoot, picking, marked
  - **ヘルパー関数**:
    - uid(): crypto.randomUUID()
    - getDocRect(): getBoundingClientRect + scroll
    - labelFor(): タグ名+ID+クラス
    - isVisibleRect(): 最小サイズチェック
    - buildMeta(): URL/title/viewport/scroll
  - **scanCandidates()**: 
    - header/main/footer/nav/aside/section検出
    - body直下要素（面積順上位20件）
  - **ensureOverlayRoot()**: オーバーレイ用div作成
  - **clearOverlay()**: オーバーレイクリア
  - **drawHighlights()**: 選択要素のハイライト描画
  - **startPick()**: Pickモード（mousemove/click/keydown）
  - **markSelected()**: data-figcap-id付与
  - **unmarkAll()**: data-figcap-id解除
  - **DOMフォールバック関連**:
    - FIGCAP_STYLE_WHITELIST
    - pickComputedStyle()
    - isEffectivelyHiddenFromStyle()
    - shouldSkipElementForCapture()
    - isImageElementTag()
    - hasFixedAncestor()
    - rectFromClientRect()
    - unionRects()
    - getTextNodeAbsRect()
    - captureDomSelections(): メインの抽出ロジック
  - **メッセージハンドラ**:
    - FIGCAP_PING
    - FIGCAP_SCAN
    - FIGCAP_HIGHLIGHT
    - FIGCAP_PICK_START
    - FIGCAP_MARK
    - FIGCAP_UNMARK
    - FIGCAP_CLEAR_OVERLAY
    - FIGCAP_CAPTURE_DOM

### 1.7 Overlay CSS
- [x] `figcap-extension/content/overlay.css` 作成 (2026-01-17 完了)
  - #__figcap_overlay_root__ スタイル
  - .figcap-box 基本スタイル
  - .figcap-highlight（ピンク枠）
  - .figcap-hover（水色枠）

### 1.8 アイコン作成
- [x] `figcap-extension/icons/icon.svg` 作成（SVGソース） (2026-01-17 完了)
- [x] PNG変換（ImageMagick or Inkscape） (2026-01-17 完了)
  - [x] `figcap-extension/icons/16.png` (2026-01-17 完了)
  - [x] `figcap-extension/icons/48.png` (2026-01-17 完了)
  - [x] `figcap-extension/icons/128.png` (2026-01-17 完了)
- [x] Phase 1 実装完了 (2026-01-17 完了)

---

## 🎯 Phase 2: FigmaプラグインC（figcap-figma-plugin）

### 2.1 ディレクトリ構造作成
- [x] `figcap-figma-plugin/` フォルダ作成 (2026-01-17 完了)

### 2.2 manifest.json
- [x] `figcap-figma-plugin/manifest.json` 作成 (2026-01-17 完了)
  - name: "FigCap C (JSON -> Figma)"
  - id: ローカル開発用ID
  - api: "1.0.0"
  - main: "code.js"
  - ui: "ui.html"
  - editorType: ["figma"]

### 2.3 UI
- [x] `figcap-figma-plugin/ui.html` 作成 (2026-01-17 完了)
  - JSONファイル選択 input[type=file]
  - Preserve position チェックボックス
  - Import File / Import Text / Clear / Close ボタン
  - JSONテキスト貼り付け textarea
  - ログ表示エリア
  - **JS部分**:
    - importFromFile(): ファイル読み込み→postMessage
    - importFromText(): テキスト読み込み→postMessage
    - onmessage: IMPORT_RESULT受信→ログ表示

### 2.4 メインコード（最大のファイル）
- [x] `figcap-figma-plugin/code.js` 作成 (2026-01-17 完了)
- [x] Phase 2 実装完了 (2026-01-17 完了)
- [x] テキスト空白の正規化対応 (2026-01-17 完了)
- [x] 画像取り込み失敗時もインポート継続 (2026-01-17 完了)
- [x] 画像プレースホルダー表示 (2026-01-17 完了)
  - figma.showUI() 呼び出し
  - **figma.ui.onmessage ハンドラ**:
    - CLOSE: figma.closePlugin()
    - IMPORT_JSON: パース→検証→インポート→結果通知
  - **validateFigcapJson()**: version/selections/rootRect/layers検証
  - **importFigcapToFigma()**: メインのインポートロジック
    - Preserve/Stack モード分岐
    - コンテナFrame作成
    - 各selection処理
    - 選択→ズーム
  - **buildContainerName()**: タイトル+viewport情報でFrame名生成
  - **importSelection()**: 
    - 子Frame作成
    - layers処理（paintOrder順）
    - BOX/IMAGE → createRectFromLayer
    - TEXT → createTextFromLayer
  - **createRectFromLayer()**:
    - Rectangle作成
    - applyBoxStyle()
  - **applyBoxStyle()**:
    - opacity
    - fills (background-color)
    - strokes (border)
    - cornerRadius (border-radius)
    - effects (box-shadow)
  - **createTextFromLayer()**:
    - Text作成
    - フォント解決→ロード
    - fontSize, lineHeight, letterSpacing, textAlign, color
  - **フォント関連**:
    - firstFontFamily(): CSS font-familyから最初のフォント抽出
    - weightToStyle(): font-weight → Figmaスタイル名変換
    - resolveFont(): フォント解決（フォールバック: Inter）
  - **パーシングヘルパー**:
    - normalizeBounds()
    - parsePx()
    - parseCSSColor(): hex/rgb/rgba/transparent
    - parseFirstDropShadow(): box-shadowパース
    - splitOutsideParens(): カンマ分割（括弧考慮）
  - **ユーティリティ**:
    - isFiniteNumber()
    - safeNum()
    - parseFloatSafe()
    - parseIntSafe()
    - clamp()

---

## 🐛 バグ修正

### BF-1: キャプチャ時にオーバーレイ（ハイライト枠）が混入する
- [x] 原因調査 (2026-02-07 完了)
  - captureImageClipsViaCDP() の Page.captureScreenshot 時にオーバーレイが表示されたまま
  - 紫/ピンクのハイライト枠がスクリーンショットに焼き込まれる
- [x] 修正: キャプチャ前に FIGCAP_CLEAR_OVERLAY でオーバーレイ消去、完了後に再描画 (2026-02-07 完了)

---

## 🎯 Phase 3: テスト

### 3.1 Chrome拡張Bのテスト
- [ ] Chromeに拡張を読み込み
  - chrome://extensions → Developer mode ON → Load unpacked
- [ ] 基本動作確認
  - [ ] アイコンクリックでサイドパネルが開く
  - [ ] Scanで候補リストが表示される
  - [ ] チェックボックス選択でハイライトが表示される
  - [ ] Pickモードで任意要素を追加できる
  - [ ] CaptureでJSONがダウンロードされる
  - [ ] Clearでハイライトがクリアされる
- [ ] CDP動作確認
  - [ ] 通常サイト(https)でCDPキャプチャ成功
  - [ ] CDPデバッグ通知が出ることを確認
- [ ] DOMフォールバック確認
  - [ ] CDP失敗時にフォールバックが動作する
- [ ] レスポンシブ確認
  - [ ] DevToolsデバイスモードで表示変更後にScan
  - [ ] viewportサイズがJSONに正しく反映される
- [ ] JSON形式確認
  - [ ] version: 1
  - [ ] page.url, title, viewport, scroll
  - [ ] selections[].id, rootRect, layers[]
  - [ ] layers[].type, bounds, text, style, paintOrder

### 3.2 FigmaプラグインCのテスト
- [ ] Figmaにプラグインを読み込み
  - Plugins → Development → Import plugin from manifest
- [ ] 基本動作確認
  - [ ] プラグインUIが開く
  - [ ] JSONファイル選択でインポートできる
  - [ ] JSONテキスト貼り付けでインポートできる
  - [ ] Closeでプラグインが閉じる
- [ ] インポート結果確認
  - [ ] コンテナFrameが生成される
  - [ ] 選択状態になり画面がズームする
  - [ ] selections数だけ子Frameが作成される
  - [ ] BOXがRectangleとして生成される
  - [ ] TEXTがTextとして生成される
- [ ] Preserve/Stackモード確認
  - [ ] Preserve: rootRect.x/yを使った配置
  - [ ] Stack: 縦積み配置
- [ ] スタイル反映確認
  - [ ] background-color → fills
  - [ ] border-radius → cornerRadius
  - [ ] border → strokes
  - [ ] box-shadow → effects
  - [ ] font-size, font-weight, color → Text属性
- [ ] フォントフォールバック確認
  - [ ] 存在しないフォント指定時にInterにフォールバック

### 3.3 E2Eテスト（一気通貫）
- [ ] Webページを拡張BでScan→Capture→JSONダウンロード
- [ ] FigmaでプラグインCを起動→JSONインポート
- [ ] 生成されたFrame群が元ページの構造を反映していることを確認

---

## 🎯 Phase 4: 仕上げ

### 4.1 README作成（任意）
- [ ] `README.md` にプロジェクト概要を記載
  - 使い方
  - ディレクトリ構成
  - 既知の制約

### 4.2 サンプルJSON作成（任意）
- [ ] `sample/sample.json` に最小限のテスト用JSONを配置

---

## ⚠️ 実装時の注意点

### Chrome拡張B
1. **chrome.debugger使用時の通知**: セキュリティ上避けられない
2. **file://対応**: 拡張詳細で「Allow access to file URLs」が必要
3. **maxNodesPerSelection**: DOMフォールバックは3000ノードで打ち切り
4. **meta情報**: Scan時のmetaをCapture JSONに必ず含める

### FigmaプラグインC
1. **フォントロード必須**: characters設定前にfigma.loadFontAsync()
2. **フォールバック**: 存在しないフォントはInterにフォールバック
3. **IMAGE型**: 最小実装ではRectangle扱い
4. **background-image/transform**: 未対応（許容）

---

## 📁 最終的なファイル構成

```
WebsiteToFigma/
├── .gitignore
├── TODO.md (このファイル)
├── README.md (任意)
├── Doc/
│   ├── ChromeExtention.md
│   └── FigmaPlugin.txt
├── figcap-extension/
│   ├── manifest.json
│   ├── service_worker.js
│   ├── sidepanel/
│   │   ├── sidepanel.html
│   │   ├── sidepanel.js
│   │   └── sidepanel.css
│   ├── content/
│   │   ├── contentScript.js
│   │   └── overlay.css
│   └── icons/
│       ├── icon.svg
│       ├── 16.png
│       ├── 48.png
│       └── 128.png
└── figcap-figma-plugin/
    ├── manifest.json
    ├── code.js
    └── ui.html
```

---

## 🏁 完了条件

1. Chrome拡張Bで任意のWebページをJSON化できる
2. FigmaプラグインCでJSONをインポートしてFrame/Rect/Textが生成される
3. E2Eフロー（Web→JSON→Figma）が一気通貫で動作する
