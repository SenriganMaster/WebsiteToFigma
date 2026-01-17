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
    try {
      const url = String(msg.url || "");
      if (!/^https?:\/\//i.test(url)) throw new Error("unsupported url");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, { credentials: "include", signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`http ${res.status}`);

      const blob = await res.blob();
      const maxBytes = 5 * 1024 * 1024;
      if (blob.size > maxBytes) throw new Error("image too large");

      const contentType = blob.type || "image/png";
      const buffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      const dataUrl = `data:${contentType};base64,${base64}`;

      sendResponse({ ok: true, dataUrl });
    } catch (e) {
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
