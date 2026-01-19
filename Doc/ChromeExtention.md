# Chrome拡張B「ページ状態を抽出→JSON化」最終版ドキュメント

対象：このプロジェクトを引き継ぐ開発者/AI  
目的：このドキュメントだけで拡張機能の実装・挙動が把握できる状態にする

---

## 0. ゴールと現在の完成度
- Webページの現在表示状態を解析し、**Figmaプラグインで再構築しやすいJSON**を出力するChrome拡張（Manifest V3）。
- CDP優先でDOMスナップショットを取得し、失敗時はDOMフォールバックで同型JSONを出す。
- 画像は service worker でクロスオリジンfetchし、dataURLとして埋め込み（CORS回避）。取得失敗時もプレースホルダーで潰れない。
- テキストは正規化済み（NBSP除去・多重スペース圧縮・trim）。
- Flex系スタイル（direction/gap/padding/justify/alignなど）をJSONに含め、Figma側で安全な範囲のみAuto Layoutを適用できる。
- ALL選択チェックボックスあり、候補を一括選択可能。
- 進行バッチ（Phase1〜4）まで完了。

---

## 1. 主な機能
- **Side Panel UI**: Scan / Pick / Capture / Clear / Log
- **Scan**: header/main/footer/nav/section/aside などを候補列挙＋body直下上位20要素
- **Pick**: 任意要素をクリックで候補に追加
- **Highlight**: 選択した候補をページ上で枠表示
- **Capture**: CDPスナップショット取得 → JSON化（失敗時DOMフォールバック）
- **Meta引き継ぎ**: Scanで取得した page.meta（URL/title/viewport/DPR/scroll）をCapture結果に必ず載せる
- **画像埋め込み**: service workerでfetch→dataURL化（5MB制限、credentials omit→includeリトライ、キャッシュあり）
- **オーバーレイ**: ページ上にハイライト/ホバー枠を描画
- **maxNodesPerSelection**: 3000（DOMフォールバック打ち切り時 truncated=true）

---

## 2. ディレクトリ構成
```
figcap-extension/
  manifest.json        # MV3
  service_worker.js    # 画像fetchの中継など
  sidepanel/
    sidepanel.html
    sidepanel.js
    sidepanel.css
  content/
    contentScript.js   # 候補探索・ハイライト・DOMフォールバック
    overlay.css        # ハイライト用CSS
  icons/
    icon.svg, 16/48/128.png
```

---

## 3. manifest.json（要点）
```json
{
  "manifest_version": 3,
  "name": "FigCap B (DOM -> JSON)",
  "version": "0.1.0",
  "description": "Scan current page sections, let user select, export DOM/layout/style snapshot as JSON.",
  "action": { "default_title": "FigCap" },
  "background": { "service_worker": "service_worker.js", "type": "module" },
  "permissions": ["scripting", "sidePanel", "debugger", "downloads"],
  "host_permissions": ["<all_urls>"],
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```
注意:
- `debugger` はCDP用（通知が出ることがある）
- file:// 対象は拡張詳細画面で「Allow access to file URLs」をONにする必要あり

---

## 4. service_worker.js（要点）
- FIGCAP_FETCH_IMAGE を受け取り、fetch→dataURL化して返却（5MB制限、timeout 15s）。
- まず credentials: omit で試し、失敗時 include でリトライ。
- fetch結果をログ出力（デバッグ用）。

---

## 5. Side Panel UI（要点）
- Buttons: Scan / Pick / Capture / Clear
- Candidate一覧＋ALLチェックボックスあり
- Log表示
- PickはESCでキャンセル

---

## 6. contentScript.js（要点）
- 候補探索: header/main/footer/nav/aside/section、body直下上位20要素（面積順）
- ハイライト: overlay.css を挿入し、枠描画
- Pick: hover枠付きでクリックした要素を候補に追加
- MARK/UNMARK: CDP用に data-figcap-id を付与/除去
- DOMフォールバック:
  - styleホワイトリストで computedStyle を取得
  - 画像: img/src/currentSrc を srcに
  - テキスト: 正規化して TEXT layer
  - maxNodesPerSelection=3000 で打ち切り、truncated=true を付与

---

## 7. sidepanel.js（要点）
- Scanで meta 保持（page: url/title/viewport/scroll）
- Capture手順:
  1) ensureContentScript
  2) FIGCAP_MARK（選択要素に data-figcap-id）
  3) CDP DOMSnapshot.captureSnapshot → buildExportFromSnapshot
  4) 失敗時 FIGCAP_CAPTURE_DOM（DOMフォールバック）
  5) FIGCAP_UNMARK
  6) page meta を Scan結果で上書き
  7) JSONダウンロード（タイムスタンプ付きファイル名）

---

## 8. CDPスナップショット取得とJSON生成（要点）
- computedStyles 取得項目:
  - display, visibility, opacity
  - background-color/image
  - border-*, box-shadow
  - color, font-family/size/weight, line-height, letter-spacing, text-align
  - padding-top/right/bottom/left
  - flex-direction, flex-wrap, justify-content, align-items, align-content
  - gap, row-gap, column-gap
- buildExportFromSnapshot:
  - rootRect: 選択ノード直下の矩形、なければ subtree の union
  - bounds: rootRect相対
  - type: TEXT / IMAGE / BOX
  - text: normalizeText（NBSP除去・多重スペース圧縮・trim）
  - image: { src, alt(title) } を付与（IMAGEは空でも image object を持たせ、Figma側でプレースホルダー可）
  - parentNodeIndex / isSemantic / elemId / elemClass を保持（Figma側階層化＆命名用）
  - paintOrder: paintOrders or index

---

## 9. 画像取得
- sidepanel.js → fetchImageDataUrl() で service worker に FIGCAP_FETCH_IMAGE を送信
- service_worker.js: fetch→blob→dataURL 変換（5MB制限、timeout 15s、omit→includeリトライ）
- data:image/*;base64,... を JSON に埋め込み（Figma側で createImage 可能）
- blob:/data: の場合はそのまま or 無視（blobはnull）

---

## 10. テキスト正規化
- NBSP を通常スペースへ変換
- 多重スペースを1つに圧縮
- trim
- 空白のみのTEXTはスキップ

---

## 11. Flex/Auto Layout向け情報
- flex-direction / wrap / justify-content / align-items / gap / row-gap / column-gap / padding-* をJSONに含める
- Figma側で安全な flex row/column のみ Auto Layout を適用する前提（wrap/gridは未対応のまま）

---

## 12. JSONスキーマ（概略）
```json
{
  "version": 1,
  "capturedAt": "...",
  "page": { "url": "...", "title": "...", "viewport": {...}, "scroll": {...} },
  "selections": [
    {
      "id": "...",
      "rootNodeIndex": 123,
      "rootRect": { "x":0,"y":0,"width":...,"height":... },
      "layers": [
        {
          "nodeIndex": 10,
          "parentNodeIndex": 5,
          "tag": "header",
          "type": "BOX" | "TEXT" | "IMAGE",
          "bounds": { "x":..., "y":..., "width":..., "height":... },
          "text": "...",
          "style": { ... },   // 上記computedStyles
          "image": { "src": "...", "dataUrl": "...", "alt": "..." },
          "isSemantic": true/false,
          "elemId": "...",
          "elemClass": "...",
          "paintOrder": n
        }
      ],
      "truncated": false
    }
  ]
}
```

---

## 13. 既知の制約・注意
- `debugger`利用でChromeが「デバッグ中」と表示されることがある
- クロスオリジンiframe内は不完全 or 取得不可
- file:// は拡張詳細設定で許可が必要
- DOMフォールバックは重いので 3000 ノードで打ち切り、truncated=true
- transform/複雑な重なり/ネガティブマージンなどは再現精度が下がりうる

---

## 14. テスト観点
1) httpsサイト：Scan→Pick→Highlight→Capture→JSONダウンロード  
2) モバイル表示（DevTools Device Mode）：viewport/dpr がJSONに反映されている  
3) file://：許可ONで動作（OFFでは失敗が仕様）  
4) CDP失敗を意図的に起こしてもDOMフォールバックでJSONが出る  
5) 画像: 取得成功時は dataUrl 埋め込み。失敗時もimageオブジェクトは保持（Figma側でプレースホルダー可）  
6) Flex系: JSONに flex-direction/gap/padding/align が含まれる  

---

## 15. 今後の改善アイデア（拡張）
- wrap対応（flex-wrap: wrap → layoutWrap + counterAxisSpacing をFigma側で活用）
- grid対応（別フェーズ）
- Page.captureScreenshot clipでのビジュアルPNG添付
- より広範なスタイル取得（必要になれば追加）

---

以上が最終版のChrome拡張ドキュメント。拡張の実装・挙動はこの内容に整合済み。開発終了。***
