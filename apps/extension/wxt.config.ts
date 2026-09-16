import { defineConfig } from "wxt";

export default defineConfig({
  targetBrowsers: ["chrome", "firefox"],
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "Dockmark",
    version: "1.4.0",
    description: "Browser bridge for Dockmark tabs, reviewed Capture Inbox, sessions, Smart Collection-aware local-first search, reviewed bookmark sync, local health checks and device pairing.",
    permissions: ["storage", "tabs", "scripting"],
    optional_permissions: ["bookmarks"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
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
