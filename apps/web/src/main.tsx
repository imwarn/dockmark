import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivateRoot } from "./PrivateRoot";
import { PublicPage } from "./PublicPage";
import "./styles.css";
import "./workspaces.css";
import "./session.css";
import "./search-engines.css";
import "./bridge.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const privateRoute = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");

createRoot(root).render(
  <StrictMode>
    {privateRoute ? <PrivateRoot /> : <PublicPage />}
  </StrictMode>,
);
