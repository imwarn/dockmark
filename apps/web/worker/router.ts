import baseWorker from "./index";
import {
  AiBatchApplyHttpError,
  handleAiBatchApplyApi,
} from "./ai-batch-apply";
import {
  AiOrganizationHttpError,
  handleAiOrganizationApi,
} from "./ai-organization";
import {
  BookmarkDetailsHttpError,
  handleBookmarkDetailsApi,
} from "./bookmark-details";
import {
  AuthHttpError,
  authenticateRequest,
  authConfigured,
  deviceCanAccess,
  handleAuthApi,
  requireSameOrigin,
} from "./auth";
import {
  CaptureInboxHttpError,
  handleCaptureInboxApi,
} from "./capture-inbox";
import {
  CaptureWriteHttpError,
  handleCaptureWriteApi,
} from "./capture-write";
import {
  LibraryBatchOrganizeHttpError,
  handleLibraryBatchOrganizeApi,
} from "./library-batch-organize";
import {
  handleLocalHealthResultApi,
  LocalHealthHttpError,
} from "./local-health-result";
import {
  handleMetadataApi,
  MetadataHttpError,
} from "./metadata";
import {
  handlePublicBookmarkApi,
  PublicBookmarkHttpError,
} from "./public-bookmarks";
import { handleReorderApi, ReorderHttpError } from "./reorder";
import { handleSearchEngineApi, SearchEngineHttpError } from "./search-engines";
import { handleSessionApi, SessionHttpError } from "./sessions";
import { handleSettingsApi, SettingsHttpError } from "./settings";
import { handleSmartCollectionApi, SmartCollectionHttpError } from "./smart-collections";
import { handleTagApi, TagHttpError } from "./tags";

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];
type Env = BaseEnv & {
  DOCKMARK_ADMIN_PASSWORD?: string;
  DOCKMARK_AI_API_KEY?: string;
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

function deviceCanCapture(request: Request, pathname: string) {
  if (request.method.toUpperCase() !== "POST") return false;
  return pathname === "/api/capture/bookmark" ||
    pathname === "/api/capture/review" ||
    pathname === "/api/capture/batch";
}

async function settingsResponse(request: Request, env: Env, pathname: string) {
  try {
    return await handleSettingsApi(request, env.DB, pathname);
  } catch (error) {
    if (error instanceof SettingsHttpError) return problem(error.status, error.code, error.message);
    console.error("Dockmark Settings API error", error);
    return problem(500, "internal_error", "An unexpected server error occurred.");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = normalizedPathname(request);

    try {
      const authResponse = await handleAuthApi(request, env, pathname);
      if (authResponse) return authResponse;

      // Health and the selected appearance are intentionally public.
      if (pathname === "/api/health") return baseWorker.fetch(request, env);
      if (pathname === "/api/settings/appearance" && request.method === "GET") {
        return (await settingsResponse(request, env, pathname)) ?? problem(404, "not_found", "Settings route not found.");
      }

      const principal = await authenticateRequest(request, env);
      if (pathname.startsWith("/api/public/bookmarks") && request.method !== "GET" && principal?.kind === "session") {
        requireSameOrigin(request);
      }
      const publicResponse = await handlePublicBookmarkApi(
        request,
        env.DB,
        pathname,
        principal?.kind === "session",
      );
      if (publicResponse) return publicResponse;

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
      } else if (!deviceCanAccess(request, pathname) && !deviceCanCapture(request, pathname)) {
        return problem(403, "device_scope_denied", "This paired extension token is not allowed to perform that operation.");
      }

      if (pathname === "/api/capture/bookmark" || pathname === "/api/capture/batch") {
        try {
          const response = await handleCaptureWriteApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof CaptureWriteHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Capture Write API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/capture/review" ||
          pathname === "/api/inbox" ||
          pathname === "/api/inbox/count" ||
          /^\/api\/inbox\/[^/]+$/.test(pathname)) {
        try {
          const response = await handleCaptureInboxApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof CaptureInboxHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Capture/Inbox API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/bookmarks/with-tags" || /^\/api\/bookmarks\/[^/]+\/with-tags$/.test(pathname)) {
        try {
          const response = await handleBookmarkDetailsApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof BookmarkDetailsHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Bookmark Details API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/bookmarks/batch-organize") {
        try {
          const response = await handleLibraryBatchOrganizeApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof LibraryBatchOrganizeHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Library Batch Organize API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/ai/status" || pathname === "/api/ai/organize") {
        try {
          const response = await handleAiOrganizationApi(request, env, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof AiOrganizationHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark AI Organization API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/ai/apply") {
        try {
          const response = await handleAiBatchApplyApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof AiBatchApplyHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark AI Batch Apply API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (/^\/api\/bookmarks\/[^/]+\/health\/local-result$/.test(pathname)) {
        try {
          const response = await handleLocalHealthResultApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof LocalHealthHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Local Health API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (/^\/api\/bookmarks\/[^/]+\/metadata$/.test(pathname)) {
        try {
          const response = await handleMetadataApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof MetadataHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Metadata API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/bookmark-tags" || /^\/api\/bookmarks\/[^/]+\/tags$/.test(pathname)) {
        try {
          const response = await handleTagApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof TagHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Tag API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/smart-collections" || /^\/api\/smart-collections\/[^/]+$/.test(pathname)) {
        try {
          const response = await handleSmartCollectionApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof SmartCollectionHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Smart Collection API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/categories/reorder" || pathname === "/api/bookmarks/reorder") {
        try {
          const response = await handleReorderApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof ReorderHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Reorder API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/settings/browser" || pathname === "/api/settings/appearance") {
        return (await settingsResponse(request, env, pathname)) ?? problem(404, "not_found", "Settings route not found.");
      }

      if (pathname === "/api/search-engines" || pathname.startsWith("/api/search-engines/")) {
        try {
          const response = await handleSearchEngineApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof SearchEngineHttpError) return problem(error.status, error.code, error.message);
          console.error("Dockmark Search Engine API error", error);
          return problem(500, "internal_error", "An unexpected server error occurred.");
        }
      }

      if (pathname === "/api/sessions" || pathname.startsWith("/api/sessions/")) {
        try {
          const response = await handleSessionApi(request, env.DB, pathname);
          if (response) return response;
        } catch (error) {
          if (error instanceof SessionHttpError) return problem(error.status, error.code, error.message);
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
