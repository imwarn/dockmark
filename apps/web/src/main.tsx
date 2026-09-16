import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivateRoot } from "./PrivateRoot";
import { PublicPage } from "./PublicPage";
import { applyAppearance, bindSystemAppearanceListener, localAppearance, syncAppearanceFromCloud } from "./theme";
import "./styles.css";
import "./workspaces.css";
import "./session.css";
import "./search-engines.css";
import "./bridge.css";
import "./reorder.css";
import "./theme.css";
import "./bookmark-tags.css";
import "./inbox.css";
import "./ui-polish.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

applyAppearance(localAppearance(), false);
const unbindSystemAppearance = bindSystemAppearanceListener();
window.addEventListener("pagehide", unbindSystemAppearance, { once: true });
void syncAppearanceFromCloud();

const privateRoute = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");

createRoot(root).render(
  <StrictMode>
    {privateRoute ? <PrivateRoot /> : <PublicPage />}
  </StrictMode>,
);
