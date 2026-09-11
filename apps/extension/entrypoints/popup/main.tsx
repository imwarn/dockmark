import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "./style.css";

type TabSummary = {
  id?: number;
  title: string;
  url?: string;
  pinned: boolean;
  active: boolean;
};

function Popup() {
  const [tabs, setTabs] = useState<TabSummary[]>([]);

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: "dockmark:get-open-tabs" })
      .then((value) => setTabs((value as TabSummary[]) ?? []));
  }, []);

  return (
    <main>
      <header>
        <strong>Dockmark</strong>
        <span>{tabs.length} tabs</span>
      </header>
      <p>Browser bridge connected. Open tabs can be reused by Dockmark instead of duplicated.</p>
      <div className="tabs">
        {tabs.slice(0, 5).map((tab) => (
          <button
            key={tab.id ?? tab.url}
            disabled={tab.id == null}
            onClick={() => browser.runtime.sendMessage({ type: "dockmark:activate-tab", tabId: tab.id })}
          >
            <span>{tab.title}</span>
            <small>{tab.active ? "Current" : "Switch"}</small>
          </button>
        ))}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<StrictMode><Popup /></StrictMode>);
