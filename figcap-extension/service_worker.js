// service_worker.js (module)
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (e) {
    // ignore
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "FIGCAP_FETCH_IMAGE") return;

  (async () => {
    const url = String(msg.url || "");
    console.log("[FigCap SW] Fetching image:", url);
    
    try {
      if (!/^https?:\/\//i.test(url)) throw new Error("unsupported url");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Try without credentials first (some servers reject with credentials)
      let res;
      try {
        res = await fetch(url, { 
          credentials: "omit", 
          signal: controller.signal,
          mode: "cors"
        });
      } catch (e1) {
        console.log("[FigCap SW] First fetch failed, trying with credentials:", e1.message);
        // Retry with credentials
        res = await fetch(url, { 
          credentials: "include", 
          signal: controller.signal 
        });
      }
      clearTimeout(timeoutId);

      console.log("[FigCap SW] Fetch response:", res.status, res.statusText);
      if (!res.ok) throw new Error(`http ${res.status}`);

      const blob = await res.blob();
      console.log("[FigCap SW] Blob size:", blob.size, "type:", blob.type);
      
      const maxBytes = 5 * 1024 * 1024;
      if (blob.size > maxBytes) throw new Error("image too large");

      const contentType = blob.type || "image/png";
      const buffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const dataUrl = `data:${contentType};base64,${base64}`;

      console.log("[FigCap SW] Success! dataUrl length:", dataUrl.length);
      sendResponse({ ok: true, dataUrl });
    } catch (e) {
      console.log("[FigCap SW] Fetch failed:", url, e.message || e);
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();

  return true;
});

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
