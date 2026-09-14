import baseWorker from "./index";
import {
  AuthHttpError,
  authenticateRequest,
  authConfigured,
  deviceCanAccess,
  handleAuthApi,
  requireSameOrigin,
} from "./auth";
import {
  handlePublicBookmarkApi,
  PublicBookmarkHttpError,
} from "./public-bookmarks";
import { handleSearchEngineApi, SearchEngineHttpError } from "./search-engines";
import { handleSessionApi, SessionHttpError } from "./sessions";
import { handleSettingsApi, SettingsHttpError } from "./settings";

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];
type Env = BaseEnv & {
  DOCKMARK_ADMIN_PASSWORD?: string;
};

function problem(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalizedPathname(request: Request) {
  const pathname = new URL(request.url).pathname;
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = normalizedPathname(request);

    try {
      const authResponse = await handleAuthApi(request, env, pathname);
      if (authResponse) return authResponse;

      // Health remains intentionally public for deployment monitoring.
      if (pathname === "/api/health") return baseWorker.fetch(request, env);

      const principal = await authenticateRequest(request, env);
      const publicResponse = await handlePublicBookmarkApi(
        request,
        env.DB,
        pathname,
        principal?.kind === "session",
      );
      if (publicResponse) {
        if (request.method !== "GET" && principal?.kind === "session") requireSameOrigin(request);
        return publicResponse;
      }

      if (!pathname.startsWith("/api/")) return baseWorker.fetch(request, env);
      if (!authConfigured(env)) {
        return problem(
          503,
          "security_not_configured",
          "Dockmark private APIs are locked until the DOCKMARK_ADMIN_PASSWORD Worker secret is configured (minimum 12 characters).",
        );
      }
      if (!principal) {
        return problem(401, "authentication_required", "Sign in to Dockmark or pair this extension before using private APIs.");
      }

      if (principal.kind === "session") {
        requireSameOrigin(request);
      } else if (!deviceCanAccess(request, pathname)) {
        return problem(403, "device_scope_denied", "This paired extension token is not allowed to perform that operation.");
      }

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
    } catch (error) {
      if (error instanceof AuthHttpError || error instanceof PublicBookmarkHttpError) {
        return problem(error.status, error.code, error.message);
      }
      console.error("Dockmark router error", error);
      return problem(500, "internal_error", "An unexpected server error occurred.");
    }
  },
};
