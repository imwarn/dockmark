import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Dockmark",
    version: "0.9.0",
    description: "Browser bridge for Dockmark tabs, sessions, reviewed bookmark sync, local health checks, device pairing and local-first new-tab variant.",
    permissions: ["storage", "tabs", "scripting"],
    optional_permissions: ["bookmarks"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
