import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Dockmark",
    version: "0.1.0",
    description: "Browser bridge for Dockmark open tabs, workspaces, sessions and native bookmarks.",
    permissions: ["storage", "tabs", "bookmarks", "scripting"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
