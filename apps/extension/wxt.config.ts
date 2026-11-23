/**
 * [INPUT]: depends on defineConfig from wxt
 * [OUTPUT]: exports WXT build configuration and MV3 manifest definition for Chrome and Firefox
 * [POS]: extension build root for apps/extension; declares version 1.6.1, default_locale, localized manifest messages, and optional permissions
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { defineConfig } from "wxt";

export default defineConfig({
  targetBrowsers: ["chrome", "firefox"],
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "Dockmark",
    version: "1.6.1",
    default_locale: "en",
    description: "__MSG_extDescription__",
    icons: {
      16: "icons/dockmark-16.png",
      32: "icons/dockmark-32.png",
      48: "icons/dockmark-48.png",
      128: "icons/dockmark-128.png",
    },
    permissions: ["storage", "tabs", "scripting"],
    optional_permissions: ["bookmarks"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    commands: {
      "open-dockmark-launcher": {
        suggested_key: { default: "Alt+Shift+D" },
        description: "__MSG_cmdOpenLauncher__",
      },
    },
    omnibox: { keyword: "d" },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "dockmark@imwarn.github.io",
              data_collection_permissions: {
                required: ["none"],
              },
            },
          },
        }
      : {}),
  }),
});
