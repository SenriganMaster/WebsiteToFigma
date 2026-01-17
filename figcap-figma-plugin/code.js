// FigCap C (JSON -> Figma) - code.js
// Minimal: Frame + Rectangle + Text

figma.showUI(__html__, { width: 380, height: 420 });

figma.ui.onmessage = async (msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'CLOSE') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'IMPORT_JSON') {
    try {
      const jsonText = String(msg.jsonText || '');
      const options = msg.options || {};
      const data = JSON.parse(jsonText);

      validateFigcapJson(data);

      const stats = await importFigcapToFigma(data, options);

      figma.ui.postMessage({
        type: 'IMPORT_RESULT',
        ok: true,
        frames: stats.frames,
        rects: stats.rects,
        texts: stats.texts
      });
      figma.notify(`Imported: frames=${stats.frames}, rects=${stats.rects}, texts=${stats.texts}`);
    } catch (e) {
      figma.ui.postMessage({ type: 'IMPORT_RESULT', ok: false, error: String(e && e.message ? e.message : e) });
      figma.notify(`Import failed: ${String(e)}`, { error: true });
    }
  }
};

// ---------------------------
// Validation
// ---------------------------
function validateFigcapJson(data) {
  if (!data || typeof data !== 'object') throw new Error('JSON must be an object');
  if (data.version !== 1) throw new Error(`Unsupported version: ${data.version}`);
  if (!Array.isArray(data.selections)) throw new Error('Missing selections[]');
  for (const sel of data.selections) {
    if (!sel || typeof sel !== 'object') throw new Error('Invalid selection');
    if (!sel.rootRect) throw new Error('Selection missing rootRect');
    if (!Array.isArray(sel.layers)) throw new Error('Selection missing layers[]');
  }
}

// ---------------------------
// Import
// ---------------------------
async function importFigcapToFigma(data, options) {
  const preservePosition = options.preservePosition !== false; // default true
  const page = data.page || {};
  const selections = data.selections || [];

  // Collect selection rects
  const rects = selections
    .map(s => s.rootRect)
    .filter(r => r && isFiniteNumber(r.x) && isFiniteNumber(r.y) && isFiniteNumber(r.width) && isFiniteNumber(r.height));

  let containerWidth = 0;
  let containerHeight = 0;

  // Placement baseline
  let minX = 0, minY = 0, maxX = 0, maxY = 0;

  if (preservePosition && rects.length) {
    minX = Math.min.apply(null, rects.map(function(r) { return r.x; }));
    minY = Math.min.apply(null, rects.map(function(r) { return r.y; }));
    maxX = Math.max.apply(null, rects.map(function(r) { return r.x + r.width; }));
    maxY = Math.max.apply(null, rects.map(function(r) { return r.y + r.height; }));
    containerWidth = Math.max(1, maxX - minX);
    containerHeight = Math.max(1, maxY - minY);
  } else {
    // Stack mode
    const gap = 80;
    var widths = selections.map(function(s) { return safeNum(s.rootRect && s.rootRect.width, 1); });
    containerWidth = Math.max.apply(null, [1].concat(widths));
    containerHeight = Math.max(1,
      selections.reduce((sum, s, i) => sum + safeNum(s.rootRect && s.rootRect.height, 1) + (i ? gap : 0), 0)
    );
  }

  // Create container
  const container = figma.createFrame();
  container.name = buildContainerName(page);
  container.resize(containerWidth, containerHeight);
  container.layoutMode = 'NONE';
  container.clipsContent = false;

  // Place container near viewport center
  const center = figma.viewport.center;
  container.x = Math.round(center.x - containerWidth / 2);
  container.y = Math.round(center.y - containerHeight / 2);

  figma.currentPage.appendChild(container);

  let frames = 1;
  let rectCount = 0;
  let textCount = 0;

  if (preservePosition && rects.length) {
    for (const sel of selections) {
      const f = await importSelection(container, sel, {
        x: safeNum(sel.rootRect.x, 0) - minX,
        y: safeNum(sel.rootRect.y, 0) - minY
      }, options);
      frames += f.frames;
      rectCount += f.rects;
      textCount += f.texts;
    }
  } else {
    let yCursor = 0;
    const gap = 80;
    for (let i = 0; i < selections.length; i++) {
      const sel = selections[i];
      const f = await importSelection(container, sel, { x: 0, y: yCursor }, options);
      frames += f.frames;
      rectCount += f.rects;
      textCount += f.texts;

      yCursor += safeNum(sel.rootRect && sel.rootRect.height, 0) + gap;
    }
  }

  // Select and zoom
  figma.currentPage.selection = [container];
  figma.viewport.scrollAndZoomIntoView([container]);

  return { frames, rects: rectCount, texts: textCount };
}

function buildContainerName(page) {
  const title = (page && page.title) ? String(page.title) : 'Untitled';
  const vw = page && page.viewport && isFiniteNumber(page.viewport.innerWidth) ? page.viewport.innerWidth : '?';
  const vh = page && page.viewport && isFiniteNumber(page.viewport.innerHeight) ? page.viewport.innerHeight : '?';
  return `FigCap Import - ${title} (${vw}x${vh})`;
}

async function importSelection(parentFrame, sel, pos, options) {
  const selFrame = figma.createFrame();
  selFrame.name = `Selection ${String(sel.id || '').slice(0, 8) || ''}`.trim();
  selFrame.layoutMode = 'NONE';
  selFrame.clipsContent = true;
  selFrame.fills = []; // transparent

  const w = Math.max(1, safeNum(sel.rootRect && sel.rootRect.width, 1));
  const h = Math.max(1, safeNum(sel.rootRect && sel.rootRect.height, 1));
  selFrame.resize(w, h);

  parentFrame.appendChild(selFrame);
  selFrame.x = Math.round(safeNum(pos.x, 0));
  selFrame.y = Math.round(safeNum(pos.y, 0));

  let frames = 1;
  let rects = 0;
  let texts = 0;

  const layers = Array.isArray(sel.layers) ? sel.layers.slice() : [];
  layers.sort((a, b) => safeNum(a.paintOrder, 0) - safeNum(b.paintOrder, 0));

  // Build hierarchy: create Frames for meaningful containers
  const nodeToFigmaFrame = new Map(); // nodeIndex -> Figma Frame
  const nodeToLayer = new Map(); // nodeIndex -> layer data
  
  // First pass: index all layers by nodeIndex
  for (const layer of layers) {
    if (layer.nodeIndex != null) {
      nodeToLayer.set(layer.nodeIndex, layer);
    }
  }

  // Second pass: create Frames for semantic/visual containers first
  for (const layer of layers) {
    if (!layer || !layer.bounds) continue;
    // Only create Frame for meaningful containers (semantic or visual)
    if (!shouldKeepAsFrame(layer)) continue;
    
    const b = normalizeBounds(layer.bounds);
    if (!b) continue;

    // Find parent frame (either another semantic frame or selFrame)
    let targetParent = selFrame;
    if (layer.parentNodeIndex != null) {
      targetParent = findParentFrame(layer.parentNodeIndex, nodeToLayer, nodeToFigmaFrame, selFrame);
    }

    // Create frame for semantic container
    const frame = figma.createFrame();
    frame.name = buildLayerName(layer);
    frame.layoutMode = 'NONE';
    frame.clipsContent = false;
    frame.fills = []; // transparent
    
    targetParent.appendChild(frame);
    
    // Position relative to parent
    if (targetParent === selFrame) {
      frame.x = b.x;
      frame.y = b.y;
    } else {
      // Position relative to parent frame
      const parentLayer = findLayerForFrame(targetParent, nodeToFigmaFrame, nodeToLayer);
      if (parentLayer && parentLayer.bounds) {
        frame.x = b.x - safeNum(parentLayer.bounds.x, 0);
        frame.y = b.y - safeNum(parentLayer.bounds.y, 0);
      } else {
        frame.x = b.x;
        frame.y = b.y;
      }
    }
    frame.resize(Math.max(1, b.width), Math.max(1, b.height));

    nodeToFigmaFrame.set(layer.nodeIndex, frame);
    frames++;
  }

  // Third pass: create rectangles and text
  for (const layer of layers) {
    if (!layer || !layer.bounds) continue;
    if (layer.isSemantic) continue; // Already handled as Frame
    
    const type = String(layer.type || '').toUpperCase();

    // Find parent frame
    let targetParent = selFrame;
    if (layer.parentNodeIndex != null) {
      targetParent = findParentFrame(layer.parentNodeIndex, nodeToLayer, nodeToFigmaFrame, selFrame);
    }

    // Adjust position relative to parent
    const b = normalizeBounds(layer.bounds);
    if (!b) continue;

    // Create adjusted layer without spread syntax (Figma doesn't support it)
    var adjustedLayer = Object.assign({}, layer);
    if (targetParent !== selFrame) {
      const parentLayer = findLayerForFrame(targetParent, nodeToFigmaFrame, nodeToLayer);
      if (parentLayer && parentLayer.bounds) {
        adjustedLayer.bounds = {
          x: b.x - safeNum(parentLayer.bounds.x, 0),
          y: b.y - safeNum(parentLayer.bounds.y, 0),
          width: b.width,
          height: b.height
        };
      }
    }

    if (type === 'TEXT') {
      const ok = await createTextFromLayer(targetParent, adjustedLayer, options);
      if (ok) texts++;
    } else if (type === 'BOX' || type === 'IMAGE') {
      const ok = await createRectFromLayer(targetParent, adjustedLayer);
      if (ok) rects++;
    }
  }

  return { frames, rects, texts };
}

// Find the closest semantic parent frame for a layer
function findParentFrame(parentNodeIndex, nodeToLayer, nodeToFigmaFrame, defaultFrame) {
  let current = parentNodeIndex;
  const visited = new Set();
  
  while (current != null && !visited.has(current)) {
    visited.add(current);
    
    // Check if this node has a Figma Frame
    if (nodeToFigmaFrame.has(current)) {
      return nodeToFigmaFrame.get(current);
    }
    
    // Move to parent
    const parentLayer = nodeToLayer.get(current);
    if (parentLayer && parentLayer.parentNodeIndex != null) {
      current = parentLayer.parentNodeIndex;
    } else {
      break;
    }
  }
  
  return defaultFrame;
}

// Find the layer data for a Figma frame
function findLayerForFrame(frame, nodeToFigmaFrame, nodeToLayer) {
  for (const [nodeIndex, figmaFrame] of nodeToFigmaFrame.entries()) {
    if (figmaFrame === frame) {
      return nodeToLayer.get(nodeIndex);
    }
  }
  return null;
}

// Build a descriptive name for a layer
function buildLayerName(layer) {
  const tag = String(layer.tag || '').toLowerCase();
  const elemId = layer.elemId ? '#' + layer.elemId : '';
  const elemClass = layer.elemClass ? '.' + layer.elemClass.split(' ')[0] : '';
  
  // Capitalize tag for readability
  const tagName = tag.charAt(0).toUpperCase() + tag.slice(1);
  
  if (elemId) return tagName + elemId;
  if (elemClass) return tagName + elemClass;
  return tagName || 'Frame';
}

// Determine if a layer should be kept as a Frame (not collapsed)
function shouldKeepAsFrame(layer) {
  // Always keep semantic containers
  if (layer.isSemantic) return true;
  
  var style = layer.style || {};
  
  // Keep if has background color (not transparent)
  var bgColor = style['background-color'] || '';
  if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
    return true;
  }
  
  // Keep if has background image
  var bgImage = style['background-image'] || '';
  if (bgImage && bgImage !== 'none' && bgImage !== '') {
    return true;
  }
  
  // Keep if has border
  var bt = parsePx(style['border-top-width']);
  var br = parsePx(style['border-right-width']);
  var bb = parsePx(style['border-bottom-width']);
  var bl = parsePx(style['border-left-width']);
  if ((bt && bt > 0) || (br && br > 0) || (bb && bb > 0) || (bl && bl > 0)) {
    return true;
  }
  
  // Keep if has box-shadow
  var shadow = style['box-shadow'] || '';
  if (shadow && shadow !== 'none' && shadow !== '') {
    return true;
  }
  
  // Keep if has border-radius (visual clip)
  var rTL = parsePx(style['border-top-left-radius']);
  var rTR = parsePx(style['border-top-right-radius']);
  var rBR = parsePx(style['border-bottom-right-radius']);
  var rBL = parsePx(style['border-bottom-left-radius']);
  if ((rTL && rTL > 0) || (rTR && rTR > 0) || (rBR && rBR > 0) || (rBL && rBL > 0)) {
    return true;
  }
  
  // Keep form elements
  var tag = String(layer.tag || '').toLowerCase();
  var formTags = ['input', 'textarea', 'button', 'select', 'form'];
  if (formTags.indexOf(tag) >= 0) {
    return true;
  }
  
  // Otherwise, collapse this wrapper
  return false;
}

// ---------------------------
// Rectangle creation
// ---------------------------
async function createRectFromLayer(parent, layer) {
  const b = normalizeBounds(layer.bounds);
  if (!b) return false;

  const rect = figma.createRectangle();
  parent.appendChild(rect);

  rect.x = b.x;
  rect.y = b.y;
  rect.resize(Math.max(1, b.width), Math.max(1, b.height));

  const style = layer.style || {};
  applyBoxStyle(rect, style);

  // Image fill if dataUrl is available
  let imageLoaded = false;
  const imgDataUrl = layer.image && layer.image.dataUrl ? layer.image.dataUrl : "";
  if (imgDataUrl) {
    console.log('[FigCap] Attempting image import, dataUrl length:', imgDataUrl.length);
    try {
      const bytes = dataUrlToBytes(imgDataUrl);
      console.log('[FigCap] Decoded bytes:', bytes ? bytes.length : 'null');
      if (bytes && bytes.length > 0) {
        const img = figma.createImage(bytes);
        console.log('[FigCap] Image created, hash:', img.hash);
        rect.fills = [{
          type: 'IMAGE',
          imageHash: img.hash,
          scaleMode: 'FILL'
        }];
        imageLoaded = true;
        console.log('[FigCap] Image fill applied successfully');
      } else {
        console.log('[FigCap] No bytes decoded from dataUrl');
      }
    } catch (e) {
      // Log error for debugging but continue import
      console.log('[FigCap] Image import failed:', e.message || e);
    }
  } else if (String(layer.type || '').toUpperCase() === 'IMAGE') {
    console.log('[FigCap] IMAGE layer without dataUrl:', layer.image);
  }

  // Show placeholder if IMAGE type and image loading failed
  if (String(layer.type || '').toUpperCase() === 'IMAGE' && !imageLoaded) {
    await createImagePlaceholder(parent, rect, layer);
  }

  // name for debugging
  rect.name = `Rect ${String(layer.tag || '')}`.trim();

  return true;
}

let placeholderFontPromise = null;
async function ensurePlaceholderFont() {
  if (!placeholderFontPromise) {
    placeholderFontPromise = figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  }
  await placeholderFontPromise;
}

function imageLabelFromLayer(layer) {
  // Prefer alt text if available (check both layer.image and layer.attrs)
  const alt = (layer.image && layer.image.alt) 
    ? String(layer.image.alt).trim() 
    : (layer.attrs && layer.attrs.alt) 
      ? String(layer.attrs.alt).trim() 
      : '';
  if (alt) return alt;

  // Try to get src from layer.image or layer.attrs
  const src = (layer.image && layer.image.src) 
    ? String(layer.image.src) 
    : (layer.attrs && layer.attrs.src) 
      ? String(layer.attrs.src) 
      : '';
  if (!src) return '[IMAGE]';
  
  try {
    const url = new URL(src);
    const path = url.pathname || '';
    const name = path.split('/').filter(Boolean).pop() || url.hostname || '[IMAGE]';
    return decodeURIComponent(name);
  } catch (_) {
    const parts = src.split('/').filter(Boolean);
    return parts[parts.length - 1] || '[IMAGE]';
  }
}

async function createImagePlaceholder(parent, rect, layer) {
  try {
    await ensurePlaceholderFont();
  } catch (_) {
    return;
  }

  const label = imageLabelFromLayer(layer);

  // Create background rectangle for placeholder
  const bg = figma.createRectangle();
  parent.appendChild(bg);
  bg.x = rect.x;
  bg.y = rect.y;
  bg.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  bg.fills = [{
    type: 'SOLID',
    color: { r: 0.9, g: 0.9, b: 0.9 },
    opacity: 1
  }];
  bg.strokes = [{
    type: 'SOLID',
    color: { r: 0.7, g: 0.7, b: 0.7 },
    opacity: 1
  }];
  bg.strokeWeight = 1;
  bg.name = 'Image Placeholder BG';

  // Create text label
  const textNode = figma.createText();
  parent.appendChild(textNode);

  textNode.x = rect.x;
  textNode.y = rect.y;

  try {
    textNode.textAutoResize = 'NONE';
    textNode.resize(Math.max(1, rect.width), Math.max(1, rect.height));
  } catch (_) {}

  textNode.fontName = { family: 'Inter', style: 'Regular' };
  textNode.characters = label;
  textNode.textAlignHorizontal = 'CENTER';
  textNode.textAlignVertical = 'CENTER';
  textNode.fills = [{
    type: 'SOLID',
    color: { r: 0.4, g: 0.4, b: 0.4 },
    opacity: 1
  }];

  const size = clamp(Math.min(rect.width, rect.height) / 6, 10, 18);
  textNode.fontSize = size;
  textNode.name = 'Image Placeholder';
}

function applyBoxStyle(node, style) {
  // opacity
  const op = parseFloatSafe(style['opacity']);
  if (isFiniteNumber(op)) node.opacity = clamp(op, 0, 1);

  // fill: background-color
  const bg = parseCSSColor(style['background-color']);
  if (bg && bg.a > 0) {
    node.fills = [{
      type: 'SOLID',
      color: { r: bg.r, g: bg.g, b: bg.b },
      opacity: bg.a
    }];
  } else {
    node.fills = []; // transparent
  }

  // stroke: uniform only (minimal)
  const bt = parsePx(style['border-top-width']);
  const br = parsePx(style['border-right-width']);
  const bb = parsePx(style['border-bottom-width']);
  const bl = parsePx(style['border-left-width']);
  const widths = [bt, br, bb, bl].map(v => (isFiniteNumber(v) ? v : 0));

  const allEqual = widths.every(v => v === widths[0]);
  const strokeW = allEqual ? widths[0] : 0;

  if (strokeW > 0) {
    const bc = parseCSSColor(style['border-top-color']) || parseCSSColor(style['border-right-color']) || parseCSSColor(style['border-bottom-color']) || parseCSSColor(style['border-left-color']);
    const c = bc && bc.a > 0 ? bc : { r: 0, g: 0, b: 0, a: 1 };
    node.strokes = [{
      type: 'SOLID',
      color: { r: c.r, g: c.g, b: c.b },
      opacity: c.a
    }];
    node.strokeWeight = strokeW;
  } else {
    node.strokes = [];
  }

  // border radius (try per-corner)
  const rTL = parsePx(style['border-top-left-radius']);
  const rTR = parsePx(style['border-top-right-radius']);
  const rBR = parsePx(style['border-bottom-right-radius']);
  const rBL = parsePx(style['border-bottom-left-radius']);

  const rs = [rTL, rTR, rBR, rBL].map(v => (isFiniteNumber(v) ? v : 0));
  const sameR = rs.every(v => v === rs[0]);

  try {
    if (sameR) {
      node.cornerRadius = rs[0];
    } else {
      node.topLeftRadius = rs[0];
      node.topRightRadius = rs[1];
      node.bottomRightRadius = rs[2];
      node.bottomLeftRadius = rs[3];
    }
  } catch (_) {
    // ignore
  }

  // box-shadow (take first, non-inset)
  const shadow = parseFirstDropShadow(style['box-shadow']);
  if (shadow) {
    node.effects = [{
      type: 'DROP_SHADOW',
      color: { r: shadow.color.r, g: shadow.color.g, b: shadow.color.b, a: shadow.color.a },
      offset: { x: shadow.offsetX, y: shadow.offsetY },
      radius: shadow.blur,
      spread: shadow.spread,
      visible: true,
      blendMode: 'NORMAL'
    }];
  } else {
    node.effects = [];
  }
}

// ---------------------------
// Text creation
// ---------------------------
async function createTextFromLayer(parent, layer, options) {
  const b = normalizeBounds(layer.bounds);
  if (!b) return false;

  const textNode = figma.createText();
  parent.appendChild(textNode);

  // Geometry first (then characters)
  textNode.x = b.x;
  textNode.y = b.y;

  // Size behavior
  const autoTextWidth = !!(options && options.autoTextWidth);
  try {
    textNode.textAutoResize = autoTextWidth ? 'WIDTH_AND_HEIGHT' : 'NONE';
  } catch (_) {}

  const style = layer.style || {};
  const rawText = String(layer.text || '');

  // Font resolve + load (fallback to Inter)
  const cssFamily = firstFontFamily(style['font-family']);
  const cssWeight = style['font-weight'];
  const fontName = await resolveFont(cssFamily, cssWeight);

  // You must load before setting characters/font properties
  await figma.loadFontAsync(fontName);
  textNode.fontName = fontName;

  // Set characters
  textNode.characters = rawText;

  // Align top to reduce vertical drift
  try {
    textNode.textAlignVertical = 'TOP';
  } catch (_) {}

  // Fixed bounding box after font + characters
  if (!autoTextWidth) {
    try {
      textNode.resize(Math.max(1, b.width), Math.max(1, b.height));
    } catch (_) {}
  }

  // font size
  const fs = parsePx(style['font-size']);
  if (isFiniteNumber(fs) && fs > 0) textNode.fontSize = fs;

  // line height
  const lh = parsePx(style['line-height']);
  if (isFiniteNumber(lh) && lh > 0) {
    textNode.lineHeight = { value: lh, unit: 'PIXELS' };
  }

  // letter spacing
  const ls = parsePx(style['letter-spacing']);
  if (isFiniteNumber(ls)) {
    textNode.letterSpacing = { value: ls, unit: 'PIXELS' };
  }

  // align
  const ta = String(style['text-align'] || '').trim().toLowerCase();
  if (ta === 'center') textNode.textAlignHorizontal = 'CENTER';
  else if (ta === 'right' || ta === 'end') textNode.textAlignHorizontal = 'RIGHT';
  else if (ta === 'justify') textNode.textAlignHorizontal = 'JUSTIFIED';
  else textNode.textAlignHorizontal = 'LEFT';

  // color
  const c = parseCSSColor(style['color']);
  if (c && c.a > 0) {
    textNode.fills = [{
      type: 'SOLID',
      color: { r: c.r, g: c.g, b: c.b },
      opacity: c.a
    }];
  }

  // opacity
  const op = parseFloatSafe(style['opacity']);
  if (isFiniteNumber(op)) textNode.opacity = clamp(op, 0, 1);

  textNode.name = 'Text';

  return true;
}

function firstFontFamily(v) {
  if (!v) return null;
  const s = String(v);
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts[0].replace(/^["']|["']$/g, '');
}

function weightToStyle(weight) {
  const w = parseIntSafe(weight);
  if (w >= 700) return 'Bold';
  if (w >= 600) return 'Semi Bold';
  if (w >= 500) return 'Medium';
  return 'Regular';
}

async function resolveFont(cssFamily, cssWeight) {
  const style = weightToStyle(cssWeight);

  const candidates = [];
  if (cssFamily) candidates.push({ family: cssFamily, style });
  candidates.push({ family: 'Inter', style });
  candidates.push({ family: 'Inter', style: 'Regular' });

  for (const f of candidates) {
    try {
      await figma.loadFontAsync(f);
      return f;
    } catch (_) {
      // try next
    }
  }

  // Last resort: try Inter Regular without pre-check
  return { family: 'Inter', style: 'Regular' };
}

// ---------------------------
// Parsing helpers
// ---------------------------
function normalizeBounds(b) {
  if (!b) return null;
  const x = safeNum(b.x, null);
  const y = safeNum(b.y, null);
  const w = safeNum(b.width, null);
  const h = safeNum(b.height, null);
  if (![x, y, w, h].every(isFiniteNumber)) return null;
  if (w <= 0 || h <= 0) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h))
  };
}

function parsePx(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '0') return 0;
  const m = s.match(/^(-?\d+(\.\d+)?)px$/);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(s);
  return isFiniteNumber(n) ? n : null;
}

function parseCSSColor(v) {
  if (!v) return null;
  let s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  // hex
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return { r: r / 255, g: g / 255, b: b / 255, a: 1 };
    } else {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return { r: r / 255, g: g / 255, b: b / 255, a: 1 };
    }
  }

  const m = s.match(/^rgba?\((.*)\)$/);
  if (!m) return null;

  const inner = m[1].replace(/\//g, ' ');
  const parts = inner.split(/[\s,]+/).map(x => x.trim()).filter(Boolean);

  if (parts.length < 3) return null;

  const r = parseFloat(parts[0]);
  const g = parseFloat(parts[1]);
  const b = parseFloat(parts[2]);
  const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;

  if (![r, g, b, a].every(isFiniteNumber)) return null;

  return {
    r: clamp(r / 255, 0, 1),
    g: clamp(g / 255, 0, 1),
    b: clamp(b / 255, 0, 1),
    a: clamp(a, 0, 1)
  };
}

function parseFirstDropShadow(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === 'none') return null;

  // Split multiple shadows by commas not in parens
  const parts = splitOutsideParens(s);
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (/\binset\b/i.test(p)) continue;

    // Find color token (rgb/rgba/#hex)
    const colorMatch = p.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,6})/);
    const color = colorMatch ? parseCSSColor(colorMatch[1]) : { r: 0, g: 0, b: 0, a: 0.25 };

    // Remove color from string
    const rest = colorMatch ? p.replace(colorMatch[1], ' ') : p;
    const tokens = rest.split(/\s+/).map(t => t.trim()).filter(Boolean).filter(t => !/^inset$/i.test(t));

    // Expect: offset-x offset-y blur spread?
    const ox = parsePx(tokens[0]);
    const oy = parsePx(tokens[1]);
    const blurVal = parsePx(tokens[2]);
    const spreadVal = parsePx(tokens[3]);
    const blur = isFiniteNumber(blurVal) ? blurVal : 0;
    const spread = isFiniteNumber(spreadVal) ? spreadVal : 0;

    if (![ox, oy].every(isFiniteNumber)) continue;

    return {
      color: { r: color.r, g: color.g, b: color.b, a: color.a },
      offsetX: ox,
      offsetY: oy,
      blur: Math.max(0, blur),
      spread: Math.max(0, spread)
    };
  }

  return null;
}

function dataUrlToBytes(dataUrl) {
  const s = String(dataUrl);
  const base64Match = s.match(/^data:.*;base64,(.*)$/);
  if (base64Match) {
    const b64 = base64Match[1];
    // Use Figma's built-in base64Decode for better stability
    try {
      return figma.base64Decode(b64);
    } catch (e) {
      console.log('figma.base64Decode failed, using fallback:', e);
      // Fallback to manual decode
      const bin = atob(b64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
  }

  const textMatch = s.match(/^data:.*?,(.*)$/);
  if (!textMatch) return null;

  const text = decodeURIComponent(textMatch[1]);
  return utf8ToBytes(text);
}

function utf8ToBytes(text) {
  const encoded = new TextEncoder().encode(text);
  return encoded;
}

function splitOutsideParens(s) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);

    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf) out.push(buf);
  return out;
}

// ---------------------------
// small utils
// ---------------------------
function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function safeNum(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatSafe(v) {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(v) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
