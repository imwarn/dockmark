import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Dockmark",
    version: "0.3.1",
    description: "Browser bridge for Dockmark open tabs, workspaces, sessions and reviewed native bookmark sync.",
    permissions: ["storage", "tabs", "scripting"],
    optional_permissions: ["bookmarks"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
