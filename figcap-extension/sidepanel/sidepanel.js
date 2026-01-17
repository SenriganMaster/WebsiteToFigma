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
let lastScanMeta = null; // keep scan meta for capture
const imageCache = new Map();

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

async function updateHighlight() {
  if (!currentTabId) return;
  await chrome.tabs.sendMessage(currentTabId, { type: "FIGCAP_HIGHLIGHT", ids: [...selected] });
}

function parseSrcset(value) {
  if (!value) return "";
  const first = String(value).split(",")[0] || "";
  return first.trim().split(/\s+/)[0] || "";
}

function resolveUrl(src, baseUrl) {
  if (!src) return "";
  if (src.startsWith("data:")) return src;
  try {
    return new URL(src, baseUrl || location.href).toString();
  } catch (_) {
    return src;
  }
}

function pickImageSrcFromAttrs(attrMap, baseUrl) {
  if (!attrMap) return "";
  const direct = attrMap.get("src") || attrMap.get("data-src") || attrMap.get("data-original") || attrMap.get("data-lazy-src");
  if (direct) return resolveUrl(direct, baseUrl);
  const srcset = attrMap.get("srcset") || attrMap.get("data-srcset");
  const src = parseSrcset(srcset);
  return src ? resolveUrl(src, baseUrl) : "";
}

function renderList() {
  elList.innerHTML = "";
  const allIds = candidates.map(c => c.id);

  let cbAll = null;
  if (candidates.length) {
    const rowAll = document.createElement("label");
    rowAll.className = "cand";

    cbAll = document.createElement("input");
    cbAll.type = "checkbox";
    cbAll.checked = selected.size === allIds.length;
    cbAll.indeterminate = selected.size > 0 && selected.size < allIds.length;
    cbAll.addEventListener("change", async () => {
      if (cbAll.checked) selected = new Set(allIds);
      else selected = new Set();
      await updateHighlight();
      renderList();
    });

    const textAll = document.createElement("span");
    textAll.textContent = `ALL (${allIds.length})`;

    rowAll.appendChild(cbAll);
    rowAll.appendChild(textAll);
    elList.appendChild(rowAll);
  }

  for (const c of candidates) {
    const row = document.createElement("label");
    row.className = "cand";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(c.id);
    cb.addEventListener("change", async () => {
      if (cb.checked) selected.add(c.id);
      else selected.delete(c.id);
      await updateHighlight();
      if (cbAll) {
        cbAll.checked = selected.size === allIds.length;
        cbAll.indeterminate = selected.size > 0 && selected.size < allIds.length;
      }
    });

    const text = document.createElement("span");
    text.textContent = `[${c.category}] ${c.label} (${Math.round(c.rect.width)}x${Math.round(c.rect.height)})`;

    row.appendChild(cb);
    row.appendChild(text);
    elList.appendChild(row);
  }
}

function extractFirstUrlFromCssValue(value) {
  if (!value) return "";
  const match = String(value).match(/url\((['"]?)(.*?)\1\)/i);
  return match ? match[2] : "";
}

async function fetchImageDataUrl(url, baseUrl) {
  if (!url) return null;
  const resolved = resolveUrl(url, baseUrl);
  if (resolved.startsWith("blob:")) return null;
  if (imageCache.has(resolved)) return imageCache.get(resolved);
  if (resolved.startsWith("data:")) return resolved;

  const res = await chrome.runtime.sendMessage({ type: "FIGCAP_FETCH_IMAGE", url: resolved });
  if (res && res.ok && res.dataUrl) {
    imageCache.set(resolved, res.dataUrl);
    return res.dataUrl;
  }
  return null;
}

async function enrichImageLayers(result) {
  const selections = result && result.selections ? result.selections : [];
  const pageUrl = result && result.page && result.page.url ? result.page.url : "";
  for (const sel of selections) {
    const layers = Array.isArray(sel.layers) ? sel.layers : [];
    for (const layer of layers) {
      const existing = layer.image && layer.image.src ? layer.image.src : "";
      let src = existing;

      if (!src && layer.style && layer.style["background-image"]) {
        src = extractFirstUrlFromCssValue(layer.style["background-image"]);
      }

      if (!src) continue;

      if (src.startsWith("data:")) {
        layer.image = { src, dataUrl: src };
        continue;
      }

      const dataUrl = await fetchImageDataUrl(src, pageUrl);
      if (dataUrl) {
        layer.image = { src, dataUrl };
      }
    }
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
  lastScanMeta = res.meta || null;
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

  try {
    await enrichImageLayers(result);
  } catch (e) {
    log("Image enrich failed:", String(e));
  }

  await downloadJSON(result);
  log("Downloaded JSON.");
});

async function captureViaCDP(tabId, selectedIds, pageMeta) {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    const computedStyles = [
      "display", "visibility", "opacity",
      "background-color", "background-image",
      "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius", "border-bottom-right-radius",
      "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
      "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
      "box-shadow",
      "color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align"
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
  const nodeAttrs = new Map();
  const idToNodeIndex = new Map();
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    if (!a || !a.length) continue;
    const attrMap = new Map();
    for (let j = 0; j < a.length; j += 2) {
      const k = s(a[j]);
      const v = s(a[j + 1]);
      attrMap.set(k, v);
      if (k === "data-figcap-id") {
        if (selectedIds.includes(v)) idToNodeIndex.set(v, i);
      }
    }
    nodeAttrs.set(i, attrMap);
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

  function normalizeText(raw) {
    if (!raw) return "";
    return String(raw).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  }

  function decodeStyles(styleRow) {
    const out = {};
    for (let i = 0; i < opts.computedStyles.length; i++) {
      out[opts.computedStyles[i]] = s(styleRow[i]);
    }
    return out;
  }

  const selections = [];
  const pageUrl = opts?.pageMeta?.url || "";
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
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < layoutNodeIndex.length; i++) {
        if (!subtree.has(layoutNodeIndex[i])) continue;
        const r = rectObj(bounds[i]);
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      rootRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    const layers = [];
    for (let i = 0; i < layoutNodeIndex.length; i++) {
      const ni = layoutNodeIndex[i];
      if (!subtree.has(ni)) continue;

      const tag = s(nodeName[ni]).toLowerCase();
      const rawText = s(texts[i]);
      const t = normalizeText(rawText);
      const r = rectObj(bounds[i]);

      const rel = { x: r.x - rootRect.x, y: r.y - rootRect.y, width: r.width, height: r.height };
      if (rel.width <= 0 || rel.height <= 0) continue;

      const style = decodeStyles(stylesArr[i] || []);

      // visibility filter
      if (style["display"] === "none" || style["visibility"] === "hidden" || style["opacity"] === "0") continue;

      if (rawText && !t) continue;
      const layerType = t ? "TEXT" : (tag === "img" ? "IMAGE" : "BOX");

      let imageSrc = "";
      if (tag === "img") {
        imageSrc = pickImageSrcFromAttrs(nodeAttrs.get(ni), pageUrl);
      }
      if (!imageSrc && style["background-image"]) {
        const raw = extractFirstUrlFromCssValue(style["background-image"]);
        imageSrc = resolveUrl(raw, pageUrl);
      }

      layers.push({
        nodeIndex: ni,
        tag,
        type: layerType,
        bounds: rel,
        text: t || "",
        style,
        paintOrder: paintOrders ? paintOrders[i] : i,
        image: imageSrc ? { src: imageSrc } : undefined
      });
    }

    layers.sort((a, b) => a.paintOrder - b.paintOrder);

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
