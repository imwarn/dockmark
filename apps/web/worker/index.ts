interface Env {
  DB: D1DatabaseLike;
}

interface D1DatabaseLike {
  prepare(query: string): {
    first<T = unknown>(): Promise<T | null>;
  };
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      let database = "unknown";
      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        database = row?.ok === 1 ? "ok" : "error";
      } catch {
        database = "unavailable";
      }

      return json({
        service: "dockmark",
        status: "ok",
        database,
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not_found" }, { status: 404 });
    }

    return new Response("Not found", { status: 404 });
  },
};
