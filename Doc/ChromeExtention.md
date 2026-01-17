# Chrome拡張B「ページ状態を抽出→JSON化」開発指示書（統合版 / コピペで実装完走用）

対象読者：今回の議論を知らないが実装能力の高いAI（または開発者）
目的：この指示書だけで、拡張機能の実装が完了し、想定通りに動作すること

---

## 0. 概要

### 0.1 目的（何を作るか）

ユーザーが「今表示しているページ状態（PC/スマホ表示を含む）」に対して、

1. 拡張機能を起動
2. ページ構造を解析して「候補セクション（header/main/footer等）」を列挙
3. サイドパネル上でチェックボックス選択
4. 選択された要素だけを抽出し、**Figma等へ渡しやすいJSON**としてダウンロード

を実現するChrome拡張（Manifest V3）を作る。

### 0.2 重要要件（必須）

* **今見えている状態を優先**（DevToolsのDevice Modeでモバイル表示にしている状態も、現在のレンダリング結果をそのまま抽出対象にする）
*
* オートレイアウトは不要。**絶対座標（ただし出力はルート相対）**で良い
* 抽出方式は **CDP（chrome.debugger）優先**。失敗した場合 **DOMフォールバック**で必ずJSONを出す

---

## 1. 機能要件（MUST/SHOULD）

### 1.1 MUST

* アクティブタブに対して動作
* Side Panel UIを提供（Scan / Pick / Capture / Clear / Log）
* Scanで候補要素を列挙（checkbox）
* 選択した候補要素をページ上でハイライト
* CaptureでJSONをダウンロード（タイムスタンプ付きファイル名）
* CDPで取得できない場合、DOMフォールバックで同型JSONを出す
* Scanで取得したmeta（URL/title/viewport等）を **Capture JSONに必ず含める**

### 1.2 SHOULD

* Pickモード（ページをクリックして任意要素を候補として追加）
* maxNodesPerSelection（例：3000）で重さ制限
* 取得スタイルはホワイトリスト方式（必要最小から始める）

### 1.3 NOT REQUIRED

* Figmaへの直接インポート（別工程でOK）
* 完全ピクセルパーフェクト
* 全CSSプロパティ対応（疑似要素、複雑transform、動画等の完全再現）

---

## 2. 技術設計（大枠）

### 2.1 UI：Side Panel

Popupは閉じやすいので、Side Panelを採用する。

### 2.2 解析と抽出の流れ

* Scan：content scriptで候補要素を収集し、metaを返す
* Highlight：content scriptで枠を描画
* Capture：

  * まず content scriptで選択要素へ `data-figcap-id` を付与（MARK）
  * CDPでDOMSnapshotを取得（成功したらCDP結果でJSON生成）
  * CDPが失敗したら、content scriptの `FIGCAP_CAPTURE_DOM` でDOMフォールバック抽出
  * 最後に `page` メタは **Scanで取得したmetaを優先して必ず上書き**（CDP/DOMどちらでも）

### 2.3 座標の扱い

* 各selection（選択ルート）について rootRect を作り、各layerのboundsは rootRect基準（0,0起点）に正規化する

---

## 3. ファイル構成

```
figcap-extension/
  manifest.json
  service_worker.js
  sidepanel/
    sidepanel.html
    sidepanel.js
    sidepanel.css
  content/
    contentScript.js
    overlay.css
  icons/
    icon.svg
    16.png
    48.png
    128.png
```

---

## 4. manifest.json（MV3）

```json
{
  "manifest_version": 3,
  "name": "FigCap B (DOM -> JSON)",
  "version": "0.1.0",
  "description": "Scan current page sections, let user select, export DOM/layout/style snapshot as JSON.",
  "action": { "default_title": "FigCap" },
  "background": {
    "service_worker": "service_worker.js",
    "type": "module"
  },
  "permissions": [
    "scripting",
    "sidePanel",
    "debugger",
    "downloads"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "icons": {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  }
}
```

注意：

* `debugger` はCDP用（Chrome上で「デバッグ中」の通知が出ることがある）
* file:// を対象にする場合、拡張詳細画面で「Allow access to file URLs」をONにする必要がある（運用注意としてUIかREADMEに明記）

---

## 5. service_worker.js（最小）

```js
// service_worker.js (module)
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    // ignore
  }
});
```

---

## 6. Side Panel UI

### 6.1 sidepanel/sidepanel.html

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>FigCap</title>
    <link rel="stylesheet" href="sidepanel.css" />
  </head>
  <body>
    <header>
      <h1>FigCap B</h1>
      <div id="tabInfo"></div>
      <div class="row">
        <button id="btnScan">Scan</button>
        <button id="btnPick">Pick</button>
        <button id="btnCapture">Capture</button>
        <button id="btnClear">Clear</button>
      </div>
    </header>

    <main>
      <section>
        <h2>Candidates</h2>
        <div id="list"></div>
      </section>

      <section>
        <h2>Log</h2>
        <pre id="log"></pre>
      </section>
    </main>

    <script type="module" src="sidepanel.js"></script>
  </body>
</html>
```

### 6.2 sidepanel/sidepanel.css（例）

```css
body { font-family: system-ui, sans-serif; margin: 10px; }
.row { display: flex; gap: 8px; margin: 8px 0; }
#list { display: flex; flex-direction: column; gap: 6px; }
label.cand { display: flex; gap: 8px; align-items: center; }
pre#log { background: #111; color: #eee; padding: 8px; border-radius: 8px; max-height: 240px; overflow: auto; }
```

---

## 7. overlay.css（ページ上ハイライト用CSS）

`content/overlay.css`

```css
#__figcap_overlay_root__ {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 2147483647;
}

#__figcap_overlay_root__ .figcap-box {
  position: absolute;
  box-sizing: border-box;
  pointer-events: none;
}

#__figcap_overlay_root__ .figcap-highlight {
  border: 2px solid rgba(255, 0, 200, 0.9);
  background: rgba(255, 0, 200, 0.08);
}

#__figcap_overlay_root__ .figcap-hover {
  border: 2px solid rgba(0, 200, 255, 0.9);
  background: rgba(0, 200, 255, 0.08);
}
```

---

## 8. contentScript.js（ページ側の解析・ハイライト・Pick・DOMフォールバック）

`content/contentScript.js`

```js
(() => {
  const state = {
    candidates: new Map(), // id -> Element
    overlayRoot: null,
    picking: false,
    marked: [] // {el, prev}
  };

  // ---------------------------
  // Common helpers
  // ---------------------------
  function uid() {
    return crypto.randomUUID();
  }

  function getDocRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      width: r.width,
      height: r.height
    };
  }

  function labelFor(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList && el.classList.length ? '.' + [...el.classList].slice(0,2).join('.') : '';
    return `${tag}${id}${cls}`;
  }

  function isVisibleRect(rect) {
    return rect.width >= 10 && rect.height >= 10;
  }

  function buildMeta() {
    return {
      url: location.href,
      title: document.title,
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      scroll: { x: window.scrollX, y: window.scrollY }
    };
  }

  // ---------------------------
  // Candidate scan
  // ---------------------------
  function scanCandidates() {
    state.candidates.clear();
    const out = [];
    const seen = new Set();

    function add(el, category) {
      if (!el || seen.has(el)) return;
      seen.add(el);

      const rect = getDocRect(el);
      if (!isVisibleRect(rect)) return;

      const id = uid();
      state.candidates.set(id, el);
      out.push({
        id,
        category,
        label: labelFor(el),
        rect
      });
    }

    document.querySelectorAll("header, [role='banner']").forEach(el => add(el, "header"));
    document.querySelectorAll("main, [role='main']").forEach(el => add(el, "main"));
    document.querySelectorAll("footer, [role='contentinfo']").forEach(el => add(el, "footer"));
    document.querySelectorAll("nav, [role='navigation']").forEach(el => add(el, "nav"));
    document.querySelectorAll("aside").forEach(el => add(el, "aside"));
    document.querySelectorAll("section").forEach(el => add(el, "section"));

    // body direct children (top 20 by area)
    const bodyKids = [...document.body.children]
      .map(el => ({ el, rect: getDocRect(el) }))
      .filter(x => isVisibleRect(x.rect))
      .sort((a,b) => (b.rect.width*b.rect.height) - (a.rect.width*a.rect.height))
      .slice(0, 20);

    bodyKids.forEach(x => add(x.el, "body-child"));

    return { candidates: out, meta: buildMeta() };
  }

  // ---------------------------
  // Overlay + highlight
  // ---------------------------
  function ensureOverlayRoot() {
    if (state.overlayRoot) return state.overlayRoot;
    const root = document.createElement("div");
    root.id = "__figcap_overlay_root__";
    document.documentElement.appendChild(root);
    state.overlayRoot = root;
    return root;
  }

  function clearOverlay() {
    if (state.overlayRoot) state.overlayRoot.innerHTML = "";
  }

  function drawHighlights(ids) {
    const root = ensureOverlayRoot();
    clearOverlay();

    for (const id of ids) {
      const el = state.candidates.get(id);
      if (!el) continue;
      const rect = getDocRect(el);

      const box = document.createElement("div");
      box.className = "figcap-box figcap-highlight";
      box.style.left = rect.x + "px";
      box.style.top = rect.y + "px";
      box.style.width = rect.width + "px";
      box.style.height = rect.height + "px";
      root.appendChild(box);
    }
  }

  // ---------------------------
  // Pick mode
  // ---------------------------
  function startPick() {
    if (state.picking) return;
    state.picking = true;

    const hoverBox = document.createElement("div");
    hoverBox.className = "figcap-box figcap-hover";
    ensureOverlayRoot().appendChild(hoverBox);

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el.id === "__figcap_overlay_root__") return;
      const rect = getDocRect(el);
      hoverBox.style.left = rect.x + "px";
      hoverBox.style.top = rect.y + "px";
      hoverBox.style.width = rect.width + "px";
      hoverBox.style.height = rect.height + "px";
    }

    function stopPick() {
      if (!state.picking) return;
      state.picking = false;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      hoverBox.remove();
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;

      const rect = getDocRect(el);
      const id = uid();
      state.candidates.set(id, el);

      chrome.runtime.sendMessage({
        type: "FIGCAP_PICKED",
        picked: { id, category: "picked", label: labelFor(el), rect }
      });

      stopPick();
    }

    function onKey(e) {
      if (e.key === "Escape") stopPick();
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  // ---------------------------
  // Mark/unmark for CDP selection
  // ---------------------------
  function unmarkAll() {
    for (const m of state.marked) {
      if (m.prev == null) m.el.removeAttribute("data-figcap-id");
      else m.el.setAttribute("data-figcap-id", m.prev);
    }
    state.marked = [];
  }

  function markSelected(ids) {
    unmarkAll();
    const marked = [];
    for (const id of ids) {
      const el = state.candidates.get(id);
      if (!el) continue;
      const prev = el.getAttribute("data-figcap-id");
      el.setAttribute("data-figcap-id", id);
      marked.push({ el, prev });
    }
    state.marked = marked;
  }

  // ---------------------------
  // DOM fallback capture (FIGCAP_CAPTURE_DOM)
  // ---------------------------
  const FIGCAP_STYLE_WHITELIST = [
    "display", "visibility", "opacity",
    "background-color", "background-image",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "box-shadow",
    "color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align"
  ];
  const FIGCAP_DEFAULT_MAX_NODES = 3000;

  function pickComputedStyle(el, props = FIGCAP_STYLE_WHITELIST) {
    const cs = window.getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p) || "";
    return out;
  }

  function isEffectivelyHiddenFromStyle(styleObj) {
    const display = (styleObj["display"] || "").trim();
    const vis = (styleObj["visibility"] || "").trim();
    const op = (styleObj["opacity"] || "").trim();
    if (display === "none") return true;
    if (vis === "hidden") return true;
    if (op === "0" || op === "0.0") return true;
    return false;
  }

  function shouldSkipElementForCapture(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (el.id === "__figcap_overlay_root__") return true;
    if (el.closest && el.closest("#__figcap_overlay_root__")) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "meta" || tag === "link" || tag === "noscript") return true;
    return false;
  }

  function isImageElementTag(tag) {
    return tag === "img" || tag === "svg" || tag === "canvas" || tag === "video" || tag === "picture";
  }

  function hasFixedAncestor(el, stopEl = null) {
    let cur = el;
    while (cur && cur !== stopEl && cur.nodeType === Node.ELEMENT_NODE) {
      const cs = window.getComputedStyle(cur);
      if (cs.position === "fixed") return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function rectFromClientRect(clientRect, isFixed) {
    const x = clientRect.left + (isFixed ? 0 : window.scrollX);
    const y = clientRect.top + (isFixed ? 0 : window.scrollY);
    return { x, y, width: clientRect.width, height: clientRect.height };
  }

  function unionRects(rects) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
      if (!r) continue;
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function getTextNodeAbsRect(textNode, fixedLike) {
    try {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const clientRects = Array.from(range.getClientRects());
      range.detach?.();

      if (!clientRects.length) return null;

      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      for (const cr of clientRects) {
        minL = Math.min(minL, cr.left);
        minT = Math.min(minT, cr.top);
        maxR = Math.max(maxR, cr.right);
        maxB = Math.max(maxB, cr.bottom);
      }
      return rectFromClientRect(
        { left: minL, top: minT, width: maxR - minL, height: maxB - minT },
        fixedLike
      );
    } catch {
      return null;
    }
  }

  function captureDomSelections(ids, maxNodesPerSelection = FIGCAP_DEFAULT_MAX_NODES) {
    const page = buildMeta();
    const selections = [];

    for (const id of ids) {
      const rootEl =
        state.candidates.get(id) ||
        document.querySelector(`[data-figcap-id="${CSS.escape(id)}"]`);

      if (!rootEl || rootEl.nodeType !== Node.ELEMENT_NODE) continue;
      if (shouldSkipElementForCapture(rootEl)) continue;

      const rootFixedLike = hasFixedAncestor(rootEl, null);
      let rootRect = rectFromClientRect(rootEl.getBoundingClientRect(), rootFixedLike);

      if (rootRect.width < 1 || rootRect.height < 1) {
        const descRects = [];
        const els = rootEl.querySelectorAll("*");
        for (let i = 0; i < els.length && descRects.length < 200; i++) {
          const el = els[i];
          if (shouldSkipElementForCapture(el)) continue;
          const fixedLike = hasFixedAncestor(el, null);
          const r = rectFromClientRect(el.getBoundingClientRect(), fixedLike);
          if (r.width >= 1 && r.height >= 1) descRects.push(r);
        }
        const u = unionRects(descRects);
        if (u) rootRect = u;
      }

      const layers = [];
      let paintOrder = 0;

      const queue = [rootEl];
      let qi = 0;

      while (qi < queue.length && layers.length < maxNodesPerSelection) {
        const el = queue[qi++];
        if (!el || shouldSkipElementForCapture(el)) continue;

        const style = pickComputedStyle(el);
        if (isEffectivelyHiddenFromStyle(style)) continue;

        const tag = el.tagName.toLowerCase();
        const fixedLike = hasFixedAncestor(el, null);
        const absRect = rectFromClientRect(el.getBoundingClientRect(), fixedLike);

        if (absRect.width >= 1 && absRect.height >= 1) {
          const isImage = isImageElementTag(tag);
          const hasBg = (style["background-image"] || "").trim() !== "" && (style["background-image"] || "").trim() !== "none";
          const bgColor = (style["background-color"] || "").trim();
          const hasBgColor = bgColor !== "" && bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "transparent";
          const hasShadow = (style["box-shadow"] || "").trim() !== "" && (style["box-shadow"] || "").trim() !== "none";

          const bt = (style["border-top-width"] || "").trim();
          const br = (style["border-right-width"] || "").trim();
          const bb = (style["border-bottom-width"] || "").trim();
          const bl = (style["border-left-width"] || "").trim();
          const hasBorder = bt !== "0px" || br !== "0px" || bb !== "0px" || bl !== "0px";

          const isForm =
            tag === "input" || tag === "textarea" || tag === "button" || tag === "select" || tag === "option" || tag === "label";

          const meaningfulBox = isImage || isForm || hasBg || hasBgColor || hasBorder || hasShadow;

          if (meaningfulBox) {
            const rel = {
              x: absRect.x - rootRect.x,
              y: absRect.y - rootRect.y,
              width: absRect.width,
              height: absRect.height
            };

            if (rel.width > 0 && rel.height > 0) {
              const layer = {
                type: isImage ? "IMAGE" : "BOX",
                tag,
                bounds: rel,
                text: "",
                style,
                paintOrder: paintOrder++
              };
              if (tag === "img") layer.image = { src: el.currentSrc || el.src || "" };
              layers.push(layer);
            }
          }
        }

        // Direct text nodes -> TEXT layers
        if (layers.length < maxNodesPerSelection) {
          for (const child of el.childNodes) {
            if (layers.length >= maxNodesPerSelection) break;
            if (child.nodeType !== Node.TEXT_NODE) continue;

            const raw = child.textContent || "";
            const text = raw.replace(/\s+/g, " ").trim();
            if (!text) continue;

            const textStyle = pickComputedStyle(el);
            if (isEffectivelyHiddenFromStyle(textStyle)) continue;

            const fixedLikeText = hasFixedAncestor(el, null);
            const textAbs = getTextNodeAbsRect(child, fixedLikeText);
            if (!textAbs || textAbs.width < 1 || textAbs.height < 1) continue;

            const rel = {
              x: textAbs.x - rootRect.x,
              y: textAbs.y - rootRect.y,
              width: textAbs.width,
              height: textAbs.height
            };
            if (rel.width <= 0 || rel.height <= 0) continue;

            layers.push({
              type: "TEXT",
              tag: "#text",
              bounds: rel,
              text,
              style: {
                "color": textStyle["color"] || "",
                "font-family": textStyle["font-family"] || "",
                "font-size": textStyle["font-size"] || "",
                "font-weight": textStyle["font-weight"] || "",
                "line-height": textStyle["line-height"] || "",
                "letter-spacing": textStyle["letter-spacing"] || "",
                "text-align": textStyle["text-align"] || ""
              },
              paintOrder: paintOrder++
            });
          }
        }

        for (const ch of el.children) {
          if (layers.length >= maxNodesPerSelection) break;
          if (shouldSkipElementForCapture(ch)) continue;
          queue.push(ch);
        }
      }

      layers.sort((a, b) => a.paintOrder - b.paintOrder);

      selections.push({
        id,
        rootRect,
        layers,
        truncated: layers.length >= maxNodesPerSelection
      });
    }

    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      page,
      selections
    };
  }

  // ---------------------------
  // Message handler (including FIGCAP_PING & FIGCAP_CAPTURE_DOM)
  // ---------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type === "FIGCAP_PING") {
        sendResponse({ ok: true, injected: true, at: Date.now() });

      } else if (msg?.type === "FIGCAP_SCAN") {
        sendResponse(scanCandidates());

      } else if (msg?.type === "FIGCAP_HIGHLIGHT") {
        drawHighlights(msg.ids || []);
        sendResponse({ ok: true });

      } else if (msg?.type === "FIGCAP_PICK_START") {
        startPick();
        sendResponse({ ok: true });

      } else if (msg?.type === "FIGCAP_MARK") {
        markSelected(msg.ids || []);
        sendResponse({ ok: true });

      } else if (msg?.type === "FIGCAP_UNMARK") {
        unmarkAll();
        sendResponse({ ok: true });

      } else if (msg?.type === "FIGCAP_CLEAR_OVERLAY") {
        clearOverlay();
        sendResponse({ ok: true });

      } else if (msg?.type === "FIGCAP_CAPTURE_DOM") {
        const ids = Array.isArray(msg.ids) ? msg.ids : [];
        const maxNodes = Number.isFinite(msg.maxNodesPerSelection) ? msg.maxNodesPerSelection : FIGCAP_DEFAULT_MAX_NODES;
        sendResponse(captureDomSelections(ids, maxNodes));

      } else {
        sendResponse({ ok: false, error: "unknown message" });
      }
    })();
    return true;
  });
})();
```

---

## 9. sidepanel.js（注入→scan→highlight→capture→download / meta引き継ぎ込み）

`sidepanel/sidepanel.js`

```js
const elList = document.getElementById("list");
const elLog = document.getElementById("log");
const elTabInfo = document.getElementById("tabInfo");

const btnScan = document.getElementById("btnScan");
const btnPick = document.getElementById("btnPick");
const btnCapture = document.getElementById("btnCapture");
const btnClear = document.getElementById("btnClear");

let currentTabId = null;
let candidates = [];
let selected = new Set();
let lastScanMeta = null; // Scan meta保持（重要）

function log(...args) {
  elLog.textContent += args.join(" ") + "\n";
  elLog.scrollTop = elLog.scrollHeight;
}

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

async function ensureContentScript(tabId) {
  // Ensure overlay CSS (best-effort)
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content/overlay.css"]
    });
  } catch (_) {
    // ignore
  }

  // If already injected, PING will succeed
  try {
    await chrome.tabs.sendMessage(tabId, { type: "FIGCAP_PING" });
    return;
  } catch (_) {
    // inject
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/contentScript.js"]
  });

  // Optional verify
  try {
    await chrome.tabs.sendMessage(tabId, { type: "FIGCAP_PING" });
  } catch (_) {
    // ignore
  }
}

function renderList() {
  elList.innerHTML = "";
  for (const c of candidates) {
    const row = document.createElement("label");
    row.className = "cand";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(c.id);
    cb.addEventListener("change", async () => {
      if (cb.checked) selected.add(c.id);
      else selected.delete(c.id);
      await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_HIGHLIGHT", ids: [...selected] });
    });

    const text = document.createElement("span");
    text.textContent = `[${c.category}] ${c.label} (${Math.round(c.rect.width)}x${Math.round(c.rect.height)})`;

    row.appendChild(cb);
    row.appendChild(text);
    elList.appendChild(row);
  }
}

btnScan.addEventListener("click", async () => {
  elLog.textContent = "";
  currentTabId = await getActiveTabId();
  if (!currentTabId) return log("No active tab.");

  await ensureContentScript(currentTabId);

  const res = await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_SCAN" });
  candidates = res.candidates || [];
  selected = new Set();
  lastScanMeta = res.meta || null; // meta保存
  renderList();

  elTabInfo.textContent =
    `Tab: ${lastScanMeta?.title || ""} | ` +
    `${lastScanMeta?.viewport?.innerWidth || "?"}x${lastScanMeta?.viewport?.innerHeight || "?"} ` +
    `DPR=${lastScanMeta?.viewport?.devicePixelRatio || "?"}`;

  log(`Scan done. candidates=${candidates.length}`);
});

btnPick.addEventListener("click", async () => {
  if (!currentTabId) currentTabId = await getActiveTabId();
  if (!currentTabId) return log("No active tab.");

  await ensureContentScript(currentTabId);
  await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_PICK_START" });
  log("Pick mode: click element on page (ESC to cancel).");
});

// Receive picked element from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "FIGCAP_PICKED") {
    candidates = [msg.picked, ...candidates];
    renderList();
    log("Picked:", msg.picked.label);
  }
});

btnClear.addEventListener("click", async () => {
  selected = new Set();
  renderList();
  if (currentTabId) {
    await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_HIGHLIGHT", ids: [] });
    await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_UNMARK" });
    await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_CLEAR_OVERLAY" });
  }
  log("Cleared.");
});

btnCapture.addEventListener("click", async () => {
  if (!currentTabId) currentTabId = await getActiveTabId();
  if (!currentTabId) return log("No active tab.");

  await ensureContentScript(currentTabId);

  const ids = [...selected];
  if (!ids.length) return log("Select at least one element.");

  // Ensure we have meta (if user skipped Scan)
  let meta = lastScanMeta;
  if (!meta) {
    const res = await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_SCAN" });
    meta = res.meta || null;
    lastScanMeta = meta;
  }

  // Mark selected elements so CDP snapshot can locate them
  await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_MARK", ids });

  let result = null;
  try {
    result = await captureViaCDP(currentTabId, ids, meta);
    log("CDP capture OK.");
  } catch (e) {
    log("CDP capture failed -> fallback:", String(e));
    result = await captureViaDOMFallback(currentTabId, ids, meta);
    log("DOM fallback capture OK.");
  } finally {
    await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_UNMARK" });
  }

  // Ensure page meta is always the scan meta
  if (meta) result.page = meta;

  await downloadJSON(result);
  log("Downloaded JSON.");
});

async function captureViaCDP(tabId, selectedIds, pageMeta) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    const computedStyles = [
      "display","visibility","opacity",
      "background-color","background-image",
      "border-top-left-radius","border-top-right-radius","border-bottom-left-radius","border-bottom-right-radius",
      "border-top-width","border-right-width","border-bottom-width","border-left-width",
      "border-top-color","border-right-color","border-bottom-color","border-left-color",
      "box-shadow",
      "color","font-family","font-size","font-weight","line-height","letter-spacing","text-align"
    ];

    const snap = await chrome.debugger.sendCommand(
      { tabId },
      "DOMSnapshot.captureSnapshot",
      { computedStyles, includePaintOrder: true, includeDOMRects: false }
    );

    return buildExportFromSnapshot(snap, selectedIds, { computedStyles, pageMeta });
  } finally {
    await chrome.debugger.detach({ tabId });
  }
}

function buildExportFromSnapshot(snap, selectedIds, opts) {
  const doc = snap.documents?.[0];
  if (!doc) throw new Error("No documents in snapshot");

  const strings = snap.strings || [];
  const nodes = doc.nodes;
  const layout = doc.layout;

  const parentIndex = nodes.parentIndex || [];
  const nodeName = nodes.nodeName || [];
  const attrs = nodes.attributes || [];

  const s = (idx) => (idx == null ? "" : strings[idx] ?? "");

  // Map selected figcap-id -> nodeIndex
  const idToNodeIndex = new Map();
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    if (!a || !a.length) continue;
    for (let j = 0; j < a.length; j += 2) {
      const k = s(a[j]);
      if (k === "data-figcap-id") {
        const v = s(a[j+1]);
        if (selectedIds.includes(v)) idToNodeIndex.set(v, i);
      }
    }
  }

  // children adjacency
  const children = Array.from({ length: parentIndex.length }, () => []);
  for (let i = 0; i < parentIndex.length; i++) {
    const p = parentIndex[i];
    if (p >= 0) children[p].push(i);
  }

  function collectSubtree(rootIdx) {
    const set = new Set();
    const q = [rootIdx];
    while (q.length) {
      const cur = q.pop();
      if (set.has(cur)) continue;
      set.add(cur);
      for (const ch of children[cur] || []) q.push(ch);
    }
    return set;
  }

  const layoutNodeIndex = layout.nodeIndex || [];
  const bounds = layout.bounds || [];
  const texts = layout.text || [];
  const stylesArr = layout.styles || [];
  const paintOrders = layout.paintOrders || null;

  function rectObj(r) {
    return { x: r[0], y: r[1], width: r[2], height: r[3] };
  }

  function decodeStyles(styleRow) {
    const out = {};
    for (let i = 0; i < opts.computedStyles.length; i++) {
      out[opts.computedStyles[i]] = s(styleRow[i]);
    }
    return out;
  }

  const selections = [];
  for (const id of selectedIds) {
    const rootNode = idToNodeIndex.get(id);
    if (rootNode == null) continue;

    const subtree = collectSubtree(rootNode);

    let rootRect = null;
    for (let i = 0; i < layoutNodeIndex.length; i++) {
      if (layoutNodeIndex[i] === rootNode) {
        rootRect = rectObj(bounds[i]);
        break;
      }
    }
    if (!rootRect) {
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (let i = 0; i < layoutNodeIndex.length; i++) {
        if (!subtree.has(layoutNodeIndex[i])) continue;
        const r = rectObj(bounds[i]);
        minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width); maxY = Math.max(maxY, r.y + r.height);
      }
      rootRect = { x:minX, y:minY, width:maxX-minX, height:maxY-minY };
    }

    const layers = [];
    for (let i = 0; i < layoutNodeIndex.length; i++) {
      const ni = layoutNodeIndex[i];
      if (!subtree.has(ni)) continue;

      const tag = s(nodeName[ni]).toLowerCase();
      const t = s(texts[i]);
      const r = rectObj(bounds[i]);

      const rel = { x: r.x - rootRect.x, y: r.y - rootRect.y, width: r.width, height: r.height };
      if (rel.width <= 0 || rel.height <= 0) continue;

      const style = decodeStyles(stylesArr[i] || []);

      // visibility filter
      if (style["display"] === "none" || style["visibility"] === "hidden" || style["opacity"] === "0") continue;

      const layerType = t ? "TEXT" : (tag === "img" ? "IMAGE" : "BOX");

      layers.push({
        nodeIndex: ni,
        tag,
        type: layerType,
        bounds: rel,
        text: t || "",
        style,
        paintOrder: paintOrders ? paintOrders[i] : i
      });
    }

    layers.sort((a,b) => a.paintOrder - b.paintOrder);

    selections.push({
      id,
      rootNodeIndex: rootNode,
      rootRect,
      layers
    });
  }

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    page: opts?.pageMeta || {},
    selections
  };
}

async function captureViaDOMFallback(tabId, selectedIds, pageMeta) {
  const res = await chrome.tabs.sendMessage(tabId, {
    type: "FIGCAP_CAPTURE_DOM",
    ids: selectedIds,
    maxNodesPerSelection: 3000
  });
  if (pageMeta) res.page = pageMeta;
  return res;
}

async function downloadJSON(obj) {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const filename = `figcap_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

  await chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
```

---

## 10. アイコン作成（ダミーでOK）

### 10.1 icons/icon.svg を作成

`icons/icon.svg`

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect x="8" y="8" width="112" height="112" rx="24" fill="#111827"/>
  <circle cx="64" cy="64" r="34" fill="#EC4899"/>
  <path d="M52 84V44h28v8H61v8h16v8H61v16z" fill="#ffffff"/>
</svg>
```

### 10.2 PNG変換（どれか1つ）

* Inkscape:

```bash
mkdir -p icons
inkscape icons/icon.svg --export-type=png --export-filename=icons/128.png -w 128 -h 128
inkscape icons/icon.svg --export-type=png --export-filename=icons/48.png  -w 48  -h 48
inkscape icons/icon.svg --export-type=png --export-filename=icons/16.png  -w 16  -h 16
```

* ImageMagick:

```bash
mkdir -p icons
magick icons/icon.svg -resize 128x128 icons/128.png
magick icons/icon.svg -resize 48x48   icons/48.png
magick icons/icon.svg -resize 16x16   icons/16.png
```

（動作確認だけなら manifest の iconsブロックを削ってもOK）

---

## 11. 期待する出力JSON仕様

```json
{
  "version": 1,
  "capturedAt": "2026-01-17T12:34:56.000Z",
  "page": {
    "url": "...",
    "title": "...",
    "viewport": { "innerWidth": 390, "innerHeight": 844, "devicePixelRatio": 3 },
    "scroll": { "x": 0, "y": 120 }
  },
  "selections": [
    {
      "id": "....",
      "rootRect": { "x": 0, "y": 0, "width": 390, "height": 1200 },
      "layers": [
        {
          "type": "BOX",
          "tag": "div",
          "bounds": { "x": 0, "y": 0, "width": 390, "height": 64 },
          "style": { "background-color": "rgb(255,255,255)" }
        },
        {
          "type": "TEXT",
          "tag": "#text",
          "bounds": { "x": 16, "y": 20, "width": 200, "height": 24 },
          "text": "Hello",
          "style": { "font-size": "16px", "font-weight": "700", "color": "rgb(0,0,0)" }
        }
      ]
    }
  ]
}
```

* `page` は必ず Scan meta を反映（Capture時に上書き統一）
* `layers[].bounds` は rootRect 相対（0,0起点）

---

## 12. テスト計画（合格条件）

### 12.1 ケース

1. httpsサイト：Scan→候補→選択→ハイライト→Capture→JSON DL
2. DevToolsでモバイル表示：viewportが変わった状態でScan/Capture→JSONのviewportが一致
3. file://：Allow access to file URLs がONなら動く（OFFだと失敗するので注意表示）
4. CDP失敗：意図的に `chrome.debugger.attach` を失敗させても DOMフォールバックでJSONが出る

### 12.2 期待

* いずれのケースでも **JSONダウンロードができること**
* page meta が入っていること
* selectionのrootRectとlayerが相対座標で出ていること

---

## 13. 既知の制約（受け入れる）

* `chrome.debugger` 利用時の通知は仕様上避けられない場合がある
* クロスオリジンiframe内部は取得できない/不完全な場合がある
* DOMフォールバックは重いので maxNodesPerSelection で打ち切る（truncatedを付ける）

---

## 14. 次の拡張（将来）

* 選択要素を `Page.captureScreenshot` のclipでPNG化し、JSONに添付（見た目再現度UP）
* JSONをFigmaプラグインで読み込み、Frame/Rect/Text生成（別指示書で対応）
