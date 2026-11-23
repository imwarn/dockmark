/**
 * [INPUT]: depends on React hooks; depends on textContainsTokenOrPinyin from @dockmark/core; depends on browser from wxt/browser; depends on TabSummary, hostLabel, hostMonogram from ./api; depends on tx and ResolvedLocale from ../../lib/ext-locale
 * [OUTPUT]: exports OpenTabsPanel component providing real-time filterable open-tab switching with Pinyin initial matching, clear button, and keyboard navigation
 * [POS]: searchable open-tabs view rendered in Capture tab and local-only mode of apps/extension/entrypoints/popup
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { textContainsTokenOrPinyin } from "@dockmark/core";
import { browser } from "wxt/browser";
import { tx, type ResolvedLocale } from "../../lib/ext-locale";
import { hostLabel, hostMonogram, type TabSummary } from "./api";

export function OpenTabsPanel({
  tabs,
  locale,
}: {
  tabs: TabSummary[];
  locale: ResolvedLocale;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredTabs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return tabs;
    const terms = needle.split(/\s+/).filter(Boolean);
    return tabs.filter((tab) => {
      const title = tab.title || "";
      const url = tab.url || "";
      return terms.every((term) => textContainsTokenOrPinyin(title, term) || textContainsTokenOrPinyin(url, term));
    });
  }, [tabs, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filteredTabs.length]);

  function activateTab(tab: TabSummary | undefined) {
    if (tab?.id == null) return;
    void browser.runtime.sendMessage({ type: "dockmark:activate-tab", tabId: tab.id });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      return;
    }
    if (!filteredTabs.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % filteredTabs.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + filteredTabs.length) % filteredTabs.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateTab(filteredTabs[selectedIndex] ?? filteredTabs[0]);
    }
  }

  return (
    <section className="open-tabs-section" data-testid="popup-open-tabs">
      <div className="section-heading">
        <strong>{tx(locale, "Open tabs", "打开的标签页")}</strong>
        <span>{query.trim() ? `${filteredTabs.length} / ${tabs.length}` : tabs.length}</span>
      </div>
      <div className="tab-search-wrap">
        <span className="tab-search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          className="tab-search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tx(
            locale,
            `Filter ${tabs.length} open tabs… (Enter to switch)`,
            `筛选 ${tabs.length} 个打开的标签页…（支持拼音首字母，回车切换）`,
          )}
          aria-label={tx(locale, "Filter open tabs", "筛选打开的标签页")}
        />
        {query && (
          <button
            type="button"
            className="tab-search-clear"
            aria-label={tx(locale, "Clear search", "清空搜索")}
            title={tx(locale, "Clear search", "清空搜索")}
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >×</button>
        )}
      </div>
      <div className="tabs">
        {filteredTabs.map((tab, index) => (
          <button
            className={`tab-row${tab.active ? " is-active" : ""}${query.trim() && index === selectedIndex ? " is-selected" : ""}`}
            type="button"
            key={tab.id ?? `${tab.url}-${index}`}
            disabled={tab.id == null}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => activateTab(tab)}
          >
            <span className="row-monogram" aria-hidden="true">
              {hostMonogram(tab.url, tab.title)}
            </span>
            <span className="row-copy">
              <strong>{tab.title || tab.url}</strong>
              <small>{hostLabel(tab.url)}</small>
            </span>
            <em className={`tab-action-pill${tab.active ? " current" : ""}`}>
              {tab.active ? tx(locale, "Current", "当前") : tx(locale, "Switch", "切换")}
            </em>
          </button>
        ))}
        {!filteredTabs.length && (
          <p className="empty">
            {query.trim()
              ? tx(locale, "No matching tabs.", "没有匹配的标签页。")
              : tx(locale, "No open tabs found.", "未检测到打开的标签页。")}
          </p>
        )}
      </div>
    </section>
  );
}
