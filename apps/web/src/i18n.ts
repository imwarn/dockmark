/**
 * [INPUT]: depends on useCallback, useEffect, useState from react; depends on LOCALE_STORAGE_KEY, normalizeLocalePreference, resolveLocale, tx, and settings/locale types from @dockmark/core; depends on applyLocalePreference, saveAppearanceAndLocale, and syncAppearanceFromCloud from ./theme
 * [OUTPUT]: exports PUBLIC_LOCALE_STORAGE_KEY, localLocalePreference, currentResolvedLocale, applyLocalePreference, bindSystemLocaleListener, saveAppearanceAndLocale, syncAppearanceAndLocaleFromCloud, useI18n, and usePublicI18n
 * [POS]: web i18n state, cloud sync, and React hooks for private app and public visitor routes in apps/web/src
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useState } from "react";
import {
  LOCALE_STORAGE_KEY,
  normalizeLocalePreference,
  resolveLocale,
  tx as coreTx,
  type AppearanceSettings,
  type LocalePreference,
  type ResolvedLocale,
} from "@dockmark/core";
import {
  applyLocalePreference,
  saveAppearanceAndLocale,
  syncAppearanceFromCloud,
} from "./theme";

export const PUBLIC_LOCALE_STORAGE_KEY = "dockmarkPublicLocaleV1";

export { applyLocalePreference, saveAppearanceAndLocale };

export function localLocalePreference(): LocalePreference {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeLocalePreference(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function currentResolvedLocale(): ResolvedLocale {
  return resolveLocale(localLocalePreference());
}

export function bindSystemLocaleListener(): () => void {
  const listener = () => {
    if (localLocalePreference() === "system") {
      applyLocalePreference("system", false);
    }
  };
  window.addEventListener("languagechange", listener);
  return () => window.removeEventListener("languagechange", listener);
}

export async function syncAppearanceAndLocaleFromCloud(): Promise<AppearanceSettings | null> {
  return syncAppearanceFromCloud();
}

function localPublicLocalePreference(): LocalePreference {
  if (typeof window === "undefined") return "system";
  try {
    return normalizeLocalePreference(window.localStorage.getItem(PUBLIC_LOCALE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function applyPublicDocumentLocale(preference: LocalePreference, persist = false): ResolvedLocale {
  const normalized = normalizeLocalePreference(preference);
  const resolved = resolveLocale(normalized);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.localePreference = normalized;
    document.documentElement.dataset.locale = resolved;
    document.documentElement.lang = resolved;
  }
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PUBLIC_LOCALE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage write failures in restricted browser contexts.
    }
    window.dispatchEvent(new CustomEvent("dockmark:public-locale", { detail: { preference: normalized, locale: resolved } }));
  }
  return resolved;
}

export function useI18n(): {
  locale: ResolvedLocale;
  localePreference: LocalePreference;
  isZh: boolean;
  tx: (en: string, zh: string) => string;
  setLocalePreference: (next: LocalePreference, options?: { syncCloud?: boolean }) => Promise<void>;
} {
  const [localePreference, setPreferenceState] = useState<LocalePreference>(() => localLocalePreference());
  const [locale, setLocaleState] = useState<ResolvedLocale>(() => resolveLocale(localLocalePreference()));

  useEffect(() => {
    const syncFromLocal = () => {
      const nextPref = localLocalePreference();
      setPreferenceState(nextPref);
      setLocaleState(resolveLocale(nextPref));
    };

    const onLocaleEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: LocalePreference; locale?: ResolvedLocale }>).detail;
      if (detail?.preference) {
        const nextPref = normalizeLocalePreference(detail.preference);
        setPreferenceState(nextPref);
        setLocaleState(detail.locale ?? resolveLocale(nextPref));
      } else {
        syncFromLocal();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
      const nextPref = localLocalePreference();
      applyLocalePreference(nextPref, false);
      setPreferenceState(nextPref);
      setLocaleState(resolveLocale(nextPref));
    };

    const onLanguageChange = () => {
      const nextPref = localLocalePreference();
      if (nextPref === "system") {
        applyLocalePreference("system", false);
      }
      syncFromLocal();
    };

    window.addEventListener("dockmark:locale", onLocaleEvent);
    window.addEventListener("storage", onStorage);
    window.addEventListener("languagechange", onLanguageChange);
    return () => {
      window.removeEventListener("dockmark:locale", onLocaleEvent);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("languagechange", onLanguageChange);
    };
  }, []);

  const setLocalePreference = useCallback(
    async (next: LocalePreference, options?: { syncCloud?: boolean }) => {
      const normalized = normalizeLocalePreference(next);
      const resolved = applyLocalePreference(normalized, true);
      setPreferenceState(normalized);
      setLocaleState(resolved);

      if (options?.syncCloud === false) return;

      try {
        const saved = await saveAppearanceAndLocale({ locale: normalized });
        const savedResolved = applyLocalePreference(saved.locale, true);
        setPreferenceState(saved.locale);
        setLocaleState(savedResolved);
      } catch (caught) {
        const status = typeof caught === "object" && caught !== null && "status" in caught
          ? (caught as { status?: unknown }).status
          : undefined;
        if (status === 401 || status === 403) return;
        throw caught;
      }
    },
    [],
  );

  const tx = useCallback((en: string, zh: string) => coreTx(locale, en, zh), [locale]);

  return {
    locale,
    localePreference,
    isZh: locale === "zh-CN",
    tx,
    setLocalePreference,
  };
}

export function usePublicI18n(): {
  locale: ResolvedLocale;
  localePreference: LocalePreference;
  isZh: boolean;
  tx: (en: string, zh: string) => string;
  setLocalePreference: (next: LocalePreference) => void;
} {
  const [localePreference, setPreferenceState] = useState<LocalePreference>(() => localPublicLocalePreference());
  const [locale, setLocaleState] = useState<ResolvedLocale>(() => resolveLocale(localPublicLocalePreference()));

  useEffect(() => {
    const syncPublic = () => {
      const nextPref = localPublicLocalePreference();
      const nextLocale = applyPublicDocumentLocale(nextPref, false);
      setPreferenceState(nextPref);
      setLocaleState(nextLocale);
    };

    syncPublic();

    const onPublicLocaleEvent = () => {
      syncPublic();
    };

    const onOwnerLocaleEvent = () => {
      // Keep the visitor's public page language intact if cloud appearance sync finishes after mount.
      applyPublicDocumentLocale(localPublicLocalePreference(), false);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PUBLIC_LOCALE_STORAGE_KEY) return;
      syncPublic();
    };

    const onLanguageChange = () => {
      syncPublic();
    };

    window.addEventListener("dockmark:public-locale", onPublicLocaleEvent);
    window.addEventListener("dockmark:locale", onOwnerLocaleEvent);
    window.addEventListener("storage", onStorage);
    window.addEventListener("languagechange", onLanguageChange);
    return () => {
      window.removeEventListener("dockmark:public-locale", onPublicLocaleEvent);
      window.removeEventListener("dockmark:locale", onOwnerLocaleEvent);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("languagechange", onLanguageChange);
    };
  }, []);

  const setLocalePreference = useCallback((next: LocalePreference) => {
    const normalized = normalizeLocalePreference(next);
    const resolved = applyPublicDocumentLocale(normalized, true);
    setPreferenceState(normalized);
    setLocaleState(resolved);
  }, []);

  const tx = useCallback((en: string, zh: string) => coreTx(locale, en, zh), [locale]);

  return {
    locale,
    localePreference,
    isZh: locale === "zh-CN",
    tx,
    setLocalePreference,
  };
}
