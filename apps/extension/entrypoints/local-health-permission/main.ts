/**
 * [INPUT]: depends on browser from wxt/browser; depends on LOCAL_HEALTH_PENDING_KEY from ../../lib/local-health; depends on ext-locale helpers from ../../lib/ext-locale
 * [OUTPUT]: renders the scoped single-host local health permission prompt with light/dark theme and EN/zh-CN localization
 * [POS]: standalone extension entrypoint opened by lib/local-health.ts when a local/private bookmark needs explicit browser host permission
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { browser } from "wxt/browser";
import {
  applyExtensionAppearance,
  applyExtensionLocale,
  hydrateExtensionPreferences,
  readLocalAppearance,
  readLocalLocalePreference,
  subscribeExtensionPreferences,
  tx,
  type ResolvedLocale,
} from "../../lib/ext-locale";
import {
  LOCAL_HEALTH_PENDING_KEY,
  type PendingLocalHealthPermission,
} from "../../lib/local-health";
import "./style.css";

applyExtensionAppearance(readLocalAppearance(), false);
let currentLocale: ResolvedLocale = applyExtensionLocale(readLocalLocalePreference(), false).locale;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const appRoot = root;

let pending: PendingLocalHealthPermission | null = null;
let busy = false;
let message: string | null = null;
let error: string | null = null;

function syncDocumentTitle() {
  document.title = tx(
    currentLocale,
    "Dockmark · Local health access",
    "Dockmark · 本地健康检查权限",
  );
}

async function closeCurrentTab() {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id != null) await browser.tabs.remove(tab.id);
  else window.close();
}

function render() {
  syncDocumentTitle();
  appRoot.replaceChildren();

  const main = document.createElement("main");
  main.className = "permission-shell";

  const card = document.createElement("section");
  card.className = "permission-card";

  const brandBar = document.createElement("div");
  brandBar.className = "brand-bar";
  const mark = document.createElement("span");
  mark.className = "brand-mark";
  mark.textContent = "D·";
  const brandName = document.createElement("strong");
  brandName.textContent = "Dockmark";
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = tx(currentLocale, "Local health check", "本地健康检查");
  brandBar.append(mark, brandName, eyebrow);

  const title = document.createElement("h1");
  title.textContent = pending
    ? tx(currentLocale, "Allow this local host?", "允许访问此本地主机？")
    : tx(currentLocale, "No local host is waiting.", "当前没有待授权的本地主机。");

  const intro = document.createElement("p");
  intro.className = "intro";
  intro.textContent = pending
    ? tx(
        currentLocale,
        "Dockmark requests access only to the exact local hostname needed for the bookmark you chose to check. It does not request access to every website.",
        "Dockmark 仅向浏览器申请访问你选择检查的这一个本地主机名，不会请求访问所有网站。",
      )
    : tx(
        currentLocale,
        "Return to Dockmark Settings → Metadata & Health and choose Check locally on a local-only bookmark.",
        "请返回 Dockmark 设置 → 元数据与健康检查，在仅本地可访问的书签上选择“本地检查”。",
      );

  card.append(brandBar, title, intro);

  if (pending) {
    const host = document.createElement("div");
    host.className = "host-card";
    const label = document.createElement("small");
    label.textContent = tx(currentLocale, "Requested host permission", "申请的主机权限");
    const strong = document.createElement("strong");
    strong.textContent = pending.pattern;
    const url = document.createElement("span");
    url.textContent = pending.url;
    host.append(label, strong, url);
    card.append(host);

    const privacy = document.createElement("p");
    privacy.className = "privacy-note";
    privacy.textContent = tx(
      currentLocale,
      "Granted by your browser to this extension only. Dockmark's Worker never fetches local or private URLs.",
      "此权限仅由浏览器授予当前扩展，Dockmark 云端 Worker 始终不会请求本地或内网地址。",
    );
    card.append(privacy);

    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = tx(currentLocale, "Cancel", "取消");
    cancel.disabled = busy;
    cancel.addEventListener("click", () => void cancelPending());

    const allow = document.createElement("button");
    allow.type = "button";
    allow.className = "primary";
    allow.textContent = busy
      ? tx(currentLocale, "Waiting for browser…", "等待浏览器确认…")
      : tx(currentLocale, "Allow this host", "允许此主机");
    allow.disabled = busy;
    allow.addEventListener("click", () => void grantPending());

    actions.append(cancel, allow);
    card.append(actions);
  } else {
    const actions = document.createElement("div");
    actions.className = "actions";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "primary";
    close.textContent = tx(currentLocale, "Close", "关闭");
    close.addEventListener("click", () => void closeCurrentTab());
    actions.append(close);
    card.append(actions);
  }

  if (message || error) {
    const notice = document.createElement("div");
    notice.className = `notice ${error ? "error" : "success"}`;
    notice.textContent = error ?? message ?? "";
    card.append(notice);
  }

  main.append(card);
  appRoot.append(main);
}

async function loadPending() {
  const stored = await browser.storage.local.get(LOCAL_HEALTH_PENDING_KEY);
  const value = stored[LOCAL_HEALTH_PENDING_KEY];
  pending = value && typeof value === "object" && !Array.isArray(value)
    ? (value as PendingLocalHealthPermission)
    : null;
  render();
}

async function grantPending() {
  if (!pending || busy) return;
  const targetPattern = pending.pattern;
  busy = true;
  message = null;
  error = null;
  render();
  try {
    // Keep permissions.request synchronous from the click gesture with no await before it.
    const granted = await browser.permissions.request({ origins: [targetPattern] });
    if (!granted) {
      error = tx(
        currentLocale,
        "The browser did not grant this host permission.",
        "浏览器未授予此主机权限。",
      );
      return;
    }
    await browser.storage.local.remove(LOCAL_HEALTH_PENDING_KEY);
    await browser.runtime.sendMessage({ type: "dockmark:local-health-permission-updated" }).catch(() => undefined);
    pending = null;
    message = tx(
      currentLocale,
      "Host access granted. Return to Dockmark and run Check locally again.",
      "已授予主机访问权限。请返回 Dockmark 重新运行本地检查。",
    );
    window.setTimeout(() => void closeCurrentTab(), 900);
  } catch (caught) {
    error = caught instanceof Error
      ? caught.message
      : tx(currentLocale, "Could not grant host permission.", "无法授予主机权限。");
  } finally {
    busy = false;
    render();
  }
}

async function cancelPending() {
  if (busy) return;
  await browser.storage.local.remove(LOCAL_HEALTH_PENDING_KEY);
  pending = null;
  message = tx(currentLocale, "Request cancelled.", "已取消授权请求。");
  render();
  window.setTimeout(() => void closeCurrentTab(), 350);
}

subscribeExtensionPreferences({
  onLocale: (_pref, locale) => {
    currentLocale = locale;
    render();
  },
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[LOCAL_HEALTH_PENDING_KEY]) void loadPending();
});

void (async () => {
  const hydrated = await hydrateExtensionPreferences();
  currentLocale = hydrated.locale;
  await loadPending();
})().catch((caught) => {
  error = caught instanceof Error
    ? caught.message
    : tx(currentLocale, "Could not load the pending host permission.", "无法加载待授权的主机权限。");
  render();
});
