export const EXTENSION_RELEASE_VERSION = "0.3.0";

// Fill this when the Chrome Web Store listing is public. The UI will promote it
// to the primary action while keeping the manual download visible.
export const CHROME_WEB_STORE_URL: string | null = null;

export const EXTENSION_DOWNLOAD_URL =
  `https://github.com/imwarn/dockmark/releases/download/v${EXTENSION_RELEASE_VERSION}/dockmark-chrome-v${EXTENSION_RELEASE_VERSION}.zip`;

export const EXTENSION_RELEASE_URL =
  `https://github.com/imwarn/dockmark/releases/tag/v${EXTENSION_RELEASE_VERSION}`;

function versionParts(value: string) {
  return value
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => Number.isFinite(part) ? part : 0);
}

export function compareExtensionVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}
