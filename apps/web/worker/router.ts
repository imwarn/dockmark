import baseWorker from "./index";
import { handleSessionApi, SessionHttpError } from "./sessions";

type Env = Parameters<typeof baseWorker.fetch>[1];

function problem(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

    if (pathname === "/api/sessions" || pathname.startsWith("/api/sessions/")) {
      try {
        const response = await handleSessionApi(request, env.DB, pathname);
        if (response) return response;
      } catch (error) {
        if (error instanceof SessionHttpError) {
          return problem(error.status, error.code, error.message);
        }
        console.error("Dockmark Session API error", error);
        return problem(500, "internal_error", "An unexpected server error occurred.");
      }
    }

    return baseWorker.fetch(request, env);
  },
};
