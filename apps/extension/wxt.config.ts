import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Dockmark",
    version: "0.6.0",
    description: "Browser bridge for Dockmark tabs, sessions, reviewed bookmark sync and local-first new-tab variant.",
    permissions: ["storage", "tabs", "scripting"],
    optional_permissions: ["bookmarks"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
