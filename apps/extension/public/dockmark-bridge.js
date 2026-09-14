(() => {
  // The configured Dockmark origin also serves a deliberately public page at `/`.
  // Never expose privileged Browser Bridge actions there. Only the authenticated
  // management surface under `/app` may install the page ↔ extension relay.
  if (window.location.pathname !== "/app" && !window.location.pathname.startsWith("/app/")) return;
  if (window.__dockmarkBridgeInstalled) return;
  window.__dockmarkBridgeInstalled = true;

  const runtime = globalThis.browser?.runtime ?? globalThis.chrome?.runtime;
  if (!runtime) return;

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (
      event.source !== window ||
      !message ||
      message.source !== "dockmark-web" ||
      message.type !== "dockmark:bridge:request" ||
      typeof message.requestId !== "string" ||
      typeof message.action !== "string"
    ) {
      return;
    }

    try {
      const result = await runtime.sendMessage({
        type: "dockmark:web-bridge",
        action: message.action,
        payload: message.payload,
      });
      window.postMessage(
        {
          source: "dockmark-extension",
          type: "dockmark:bridge:response",
          requestId: message.requestId,
          ok: true,
          result,
        },
        window.location.origin,
      );
    } catch (error) {
      window.postMessage(
        {
          source: "dockmark-extension",
          type: "dockmark:bridge:response",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        window.location.origin,
      );
    }
  });

  runtime.onMessage.addListener((message) => {
    if (message?.type !== "dockmark:bridge:event" || typeof message.event !== "string") return;
    window.postMessage(
      {
        source: "dockmark-extension",
        type: "dockmark:bridge:event",
        event: message.event,
      },
      window.location.origin,
    );
  });

  window.postMessage(
    {
      source: "dockmark-extension",
      type: "dockmark:bridge:event",
      event: "ready",
    },
    window.location.origin,
  );
})();
