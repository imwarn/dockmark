import { browser } from "wxt/browser";
import {
  LOCAL_HEALTH_PENDING_KEY,
  type PendingLocalHealthPermission,
} from "../../lib/local-health";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
const appRoot = root;

let pending: PendingLocalHealthPermission | null = null;
let busy = false;
let message: string | null = null;
let error: string | null = null;

async function closeCurrentTab() {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id != null) await browser.tabs.remove(tab.id);
  else window.close();
}

function render() {
  appRoot.innerHTML = "";
  const main = document.createElement("main");
  main.className = "permission-shell";

  const card = document.createElement("section");
  card.className = "permission-card";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "LOCAL HEALTH CHECK";
  const title = document.createElement("h1");
  title.textContent = pending ? "Allow this local host?" : "No local host is waiting.";
  const intro = document.createElement("p");
  intro.className = "intro";
  intro.textContent = pending
    ? "Dockmark requests access only to the exact local hostname needed for the bookmark you chose to check. It does not request access to every website."
    : "Return to Dockmark Settings → Metadata & Health and choose Check locally on a local-only bookmark.";
  card.append(eyebrow, title, intro);

  if (pending) {
    const host = document.createElement("div");
    host.className = "host-card";
    const label = document.createElement("small");
    label.textContent = "Requested host permission";
    const strong = document.createElement("strong");
    strong.textContent = pending.pattern;
    const url = document.createElement("span");
    url.textContent = pending.url;
    host.append(label, strong, url);
    card.append(host);

    const privacy = document.createElement("p");
    privacy.className = "privacy-note";
    privacy.textContent = "The permission is granted by the browser to this extension. Dockmark's Worker still never fetches local/private URLs.";
    card.append(privacy);

    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.textContent = "Cancel";
    cancel.disabled = busy;
    cancel.addEventListener("click", () => void cancelPending());
    const allow = document.createElement("button");
    allow.className = "primary";
    allow.textContent = busy ? "Waiting for browser…" : "Allow this host";
    allow.disabled = busy;
    allow.addEventListener("click", () => void grantPending());
    actions.append(cancel, allow);
    card.append(actions);
  } else {
    const actions = document.createElement("div");
    actions.className = "actions";
    const close = document.createElement("button");
    close.className = "primary";
    close.textContent = "Close";
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
    ? value as PendingLocalHealthPermission
    : null;
  render();
}

async function grantPending() {
  if (!pending || busy) return;
  busy = true;
  message = null;
  error = null;
  render();
  try {
    const granted = await browser.permissions.request({ origins: [pending.pattern] });
    if (!granted) {
      error = "The browser did not grant this host permission.";
      return;
    }
    await browser.storage.local.remove(LOCAL_HEALTH_PENDING_KEY);
    await browser.runtime.sendMessage({ type: "dockmark:local-health-permission-updated" }).catch(() => undefined);
    pending = null;
    message = "Host access granted. Return to Dockmark and run Check locally again.";
    window.setTimeout(() => void closeCurrentTab(), 900);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not grant host permission.";
  } finally {
    busy = false;
    render();
  }
}

async function cancelPending() {
  if (busy) return;
  await browser.storage.local.remove(LOCAL_HEALTH_PENDING_KEY);
  pending = null;
  message = "Request cancelled.";
  render();
  window.setTimeout(() => void closeCurrentTab(), 350);
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[LOCAL_HEALTH_PENDING_KEY]) void loadPending();
});

void loadPending().catch((caught) => {
  error = caught instanceof Error ? caught.message : "Could not load the pending host permission.";
  render();
});
