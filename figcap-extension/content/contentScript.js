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
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList && el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "";
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

  function normalizeText(raw) {
    if (!raw) return "";
    return String(raw).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
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
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))
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
            const text = normalizeText(raw);
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
