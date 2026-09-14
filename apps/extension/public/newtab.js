const SERVER_KEY = "dockmarkServerUrl";
const status = document.getElementById("status");
const retry = document.getElementById("retry");

function validDockmarkOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function openDockmark() {
  retry.hidden = true;
  status.textContent = "Looking for your configured Dockmark origin…";

  try {
    const stored = await chrome.storage.local.get(SERVER_KEY);
    const origin = validDockmarkOrigin(stored[SERVER_KEY]);
    if (!origin) {
      status.textContent = "Dockmark is not configured yet. Open the extension popup, connect it to your Dockmark site, then try again.";
      retry.hidden = false;
      return;
    }

    status.textContent = `Opening ${origin}…`;
    window.location.replace(origin);
  } catch {
    status.textContent = "Could not read the configured Dockmark origin. Open the extension popup and reconnect, then try again.";
    retry.hidden = false;
  }
}

retry.addEventListener("click", () => void openDockmark());
void openDockmark();
