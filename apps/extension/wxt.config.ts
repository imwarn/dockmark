import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Dockmark",
    description: "Optional browser bridge for Dockmark tabs and bookmarks.",
    permissions: ["storage", "tabs", "bookmarks"],
  },
});
