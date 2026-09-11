import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Dockmark",
    description: "Optional browser bridge for Dockmark tabs, bookmarks and sessions.",
    permissions: ["storage", "tabs", "bookmarks", "scripting"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
  },
});
