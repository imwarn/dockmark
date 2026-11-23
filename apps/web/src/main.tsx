/**
 * [INPUT]: depends on PrivateRoot, PublicPage, theme helpers from ./theme, locale helpers from ./i18n, and global/feature CSS bundles
 * [OUTPUT]: bootstraps pre-paint appearance/locale state, binds system listeners, and mounts the private or public React root into #root
 * [POS]: Web SPA entrypoint. Routes /app* to PrivateRoot and all other paths to PublicPage while preventing theme/locale flash.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivateRoot } from "./PrivateRoot";
import { PublicPage } from "./PublicPage";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  bindSystemAppearanceListener,
  fetchAppearanceSettings,
  localAppearance,
} from "./theme";
import {
  applyLocalePreference,
  bindSystemLocaleListener,
  localLocalePreference,
  syncAppearanceAndLocaleFromCloud,
} from "./i18n";
import "./styles.css";
import "./workspaces.css";
import "./session.css";
import "./search-engines.css";
import "./bridge.css";
import "./reorder.css";
import "./theme.css";
import "./bookmark-tags.css";
import "./inbox.css";
import "./ui-polish.css";
import "./light-theme-consistency.css";
import "./responsive-shell.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const privateRoute = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");

applyAppearance(localAppearance(), false);
if (privateRoute) {
  applyLocalePreference(localLocalePreference(), false);
}
const unbindSystemAppearance = bindSystemAppearanceListener();
const unbindSystemLocale = bindSystemLocaleListener();
window.addEventListener(
  "pagehide",
  () => {
    unbindSystemAppearance();
    unbindSystemLocale();
  },
  { once: true },
);

if (privateRoute) {
  void syncAppearanceAndLocaleFromCloud();
} else if (!localStorage.getItem(APPEARANCE_STORAGE_KEY)) {
  void fetchAppearanceSettings()
    .then((settings) => {
      applyAppearance(settings.preference, false);
    })
    .catch(() => undefined);
}

createRoot(root).render(
  <StrictMode>
    {privateRoute ? <PrivateRoot /> : <PublicPage />}
  </StrictMode>,
);
