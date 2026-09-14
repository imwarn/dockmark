import baseWorker from "./index";
import { handleSearchEngineApi, SearchEngineHttpError } from "./search-engines";
import { handleSessionApi, SessionHttpError } from "./sessions";
import { handleSettingsApi, SettingsHttpError } from "./settings";

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

    if (pathname === "/api/settings/browser") {
      try {
        const response = await handleSettingsApi(request, env.DB, pathname);
        if (response) return response;
      } catch (error) {
        if (error instanceof SettingsHttpError) {
          return problem(error.status, error.code, error.message);
        }
        console.error("Dockmark Settings API error", error);
        return problem(500, "internal_error", "An unexpected server error occurred.");
      }
    }

    if (pathname === "/api/search-engines" || pathname.startsWith("/api/search-engines/")) {
      try {
        const response = await handleSearchEngineApi(request, env.DB, pathname);
        if (response) return response;
      } catch (error) {
        if (error instanceof SearchEngineHttpError) {
          return problem(error.status, error.code, error.message);
        }
        console.error("Dockmark Search Engine API error", error);
        return problem(500, "internal_error", "An unexpected server error occurred.");
      }
    }

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
