/**
 * [INPUT]: depends on chrome.storage.local (dockmarkServerUrl, dockmarkDeviceToken) and chrome.tabs
 * [OUTPUT]: patches window.fetch with Bearer device token for Dockmark /api/* requests and routes #manage clicks to /app
 * [POS]: auth transport layer loaded before newtab.js in apps/extension/public/newtab.html
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const SERVER_KEY = "dockmarkServerUrl";
  const TOKEN_KEY = "dockmarkDeviceToken";

  window.fetch = async (input, init = {}) => {
    try {
      const requestUrl = new URL(
        typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        window.location.href,
      );
      const stored = await chrome.storage.local.get([SERVER_KEY, TOKEN_KEY]);
      const origin = typeof stored[SERVER_KEY] === "string" ? stored[SERVER_KEY] : "";
      const token = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
      if (origin && token && requestUrl.origin === origin && requestUrl.pathname.startsWith("/api/")) {
        const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set("authorization", `Bearer ${token}`);
        return nativeFetch(input, { ...init, headers });
      }
    } catch {
      // Fall through to the original request; newtab.js will enter offline-cache mode on failure.
    }
    return nativeFetch(input, init);
  };

  document.getElementById("manage")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    void (async () => {
      const stored = await chrome.storage.local.get(SERVER_KEY);
      const origin = typeof stored[SERVER_KEY] === "string" ? stored[SERVER_KEY] : "";
      if (!origin) return;
      const target = new URL("/app", `${origin}/`).toString();
      try {
        await chrome.tabs.update({ url: target });
      } catch {
        window.location.assign(target);
      }
    })();
  }, true);
})();
