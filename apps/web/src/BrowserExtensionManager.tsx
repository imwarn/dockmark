/**
 * [INPUT]: depends on browser-bridge diagnostics from ./browser-bridge, release constants/version comparison from ./extension-distribution, BrowserSettingsManager, useI18n from ./i18n, and ./extension.css
 * [OUTPUT]: exports BrowserExtensionManager hub with profile downloads, manual install guide, BrowserSettingsManager, and live bridge diagnostics
 * [POS]: Mounted inside App.tsx for /app/extension. Presents Chromium New Tab, Chromium Standard, and Firefox MV3 packages alongside live capability checks.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BRIDGE_PROTOCOL_VERSION,
  getRawBridgeStatus,
  onBridgeEvent,
  type BrowserBridgeStatus,
} from "./browser-bridge";
import {
  CHROME_NEW_TAB_WEB_STORE_URL,
  CHROME_WEB_STORE_URL,
  EXTENSION_DOWNLOAD_URL,
  EXTENSION_RELEASE_URL,
  EXTENSION_RELEASE_VERSION,
  FIREFOX_EXTENSION_DOWNLOAD_URL,
  NEW_TAB_EXTENSION_DOWNLOAD_URL,
  compareExtensionVersions,
} from "./extension-distribution";
import { BrowserSettingsManager } from "./BrowserSettingsManager";
import { useI18n } from "./i18n";
import "./extension.css";

function external(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function BrowserExtensionManager() {
  const { tx } = useI18n();
  const [status, setStatus] = useState<BrowserBridgeStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const webStoreUrl = CHROME_WEB_STORE_URL;
  const newTabWebStoreUrl = CHROME_NEW_TAB_WEB_STORE_URL;

  const capabilityLabels = useMemo<Array<[keyof BrowserBridgeStatus["capabilities"], string]>>(
    () => [
      ["openTabs", tx("Open tabs", "打开的标签页")],
      ["activateTabs", tx("Switch to existing tabs", "切换到已有标签页")],
      ["workspaceReuse", tx("Workspace reuse", "工作区标签复用")],
      ["workspacePinned", tx("Pinned workspace tabs", "工作区固定标签页")],
      ["sessionRestore", tx("Session restore", "会话恢复")],
      ["sessionPinned", tx("Pinned session restore", "固定会话标签恢复")],
      ["nativeBookmarks", tx("Native bookmarks", "原生书签读取")],
      ["nativeBookmarkSync", tx("Native bookmark mapping sync", "原生书签映射同步")],
      ["nativeBookmarkWriteback", tx("Manual bookmark writeback", "手动书签回写")],
      ["localHealth", tx("Local URL health checks", "本地内网链接健康检查")],
    ],
    [tx],
  );

  const refresh = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setStatus(await getRawBridgeStatus());
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : tx("Dockmark browser extension was not detected.", "未检测到 Dockmark 浏览器扩展。"));
    } finally {
      setChecking(false);
    }
  }, [tx]);

  useEffect(() => {
    const unsubscribe = onBridgeEvent((event) => {
      if (event === "ready" || event === "tabs-changed" || event === "bookmarks-changed" || event === "capabilities-changed") {
        void refresh();
      }
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    void refresh();
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const protocolCompatible = status?.protocolVersion === BRIDGE_PROTOCOL_VERSION;
  const updateAvailable = Boolean(
    status && compareExtensionVersions(status.extensionVersion, EXTENSION_RELEASE_VERSION) < 0,
  );
  const nativeBookmarksGranted = Boolean(status?.permissions?.nativeBookmarks);

  const state = useMemo(() => {
    if (checking) return { label: tx("Checking", "检测中"), tone: "neutral" } as const;
    if (!status) return { label: tx("Not connected", "未连接"), tone: "warning" } as const;
    if (!protocolCompatible) return { label: tx("Update required", "需要更新"), tone: "danger" } as const;
    if (updateAvailable) return { label: tx("Update available", "有可用更新"), tone: "warning" } as const;
    if (!nativeBookmarksGranted) return { label: tx("Connected · bookmarks off", "已连接 · 未开启书签权限"), tone: "warning" } as const;
    return { label: tx("Connected", "已连接"), tone: "success" } as const;
  }, [checking, nativeBookmarksGranted, protocolCompatible, status, tx, updateAvailable]);

  return (
    <section className="extension-page">
      <div className="management-heading">
        <div>
          <h1>{tx("Browser Extension", "浏览器扩展")}</h1>
          <p>
            {tx(
              "Install the Chromium or Firefox extension for live open tabs, pinned sessions and reviewed bookmark sync.",
              "安装 Chromium 或 Firefox 扩展，解锁实时标签页切换、固定会话恢复与人工确认书签同步。",
            )}
          </p>
        </div>
        <span className={`extension-state extension-state-${state.tone}`}>{state.label}</span>
      </div>

      <div className="extension-hero-card">
        <div className="extension-hero-copy">
          <span className="extension-version">Chromium + Firefox · v{EXTENSION_RELEASE_VERSION}</span>
          <h2>
            {status
              ? tx(`Extension v${status.extensionVersion} detected`, `已检测到扩展 v${status.extensionVersion}`)
              : tx("Choose a browser profile", "选择适合你的扩展版本")}
          </h2>
          <p>
            {tx(
              "Chromium provides both a local-first New Tab profile and a Standard profile. Firefox provides a Standard MV3 package with the same reviewed Browser Bridge and safety boundaries.",
              "Chromium 提供本地优先的「新标签页版」与「标准版」；Firefox 提供标准 MV3 预览版，共享同一浏览器桥接与安全边界。",
            )}
          </p>
          {status && protocolCompatible && !nativeBookmarksGranted && (
            <div className="extension-permission-callout">
              <strong>{tx("Native bookmarks permission is off.", "原生书签权限尚未开启。")}</strong>
              <span>
                {tx(
                  "Open the Dockmark extension popup and enable bookmark access for reviewed import, sync and manual writeback. Dockmark never writes browser bookmarks in the background.",
                  "打开 Dockmark 扩展弹窗并开启「书签访问权限」，即可使用受审导入、同步与手动回写。Dockmark 绝不在后台静默写入浏览器书签。",
                )}
              </span>
            </div>
          )}
          <div className="extension-actions">
            <button className="secondary" type="button" onClick={() => setGuideOpen((open) => !open)}>
              {guideOpen ? tx("Hide installation guide", "收起安装指南") : tx("Installation guide", "安装指南")}
            </button>
            <button className="text-action" type="button" disabled={checking} onClick={() => void refresh()}>
              {checking ? tx("Checking…", "检测中…") : tx("Refresh diagnostics", "刷新诊断")}
            </button>
          </div>
        </div>
        <div className="extension-mark" aria-hidden="true">D·</div>
      </div>

      <section className="extension-profiles" aria-label={tx("Dockmark browser profiles", "Dockmark 扩展版本")}>
        <article className="extension-profile extension-profile-recommended">
          <div className="extension-profile-heading">
            <div>
              <span className="extension-profile-kicker">{tx("CHROMIUM · RECOMMENDED", "CHROMIUM · 推荐")}</span>
              <h2>Dockmark New Tab</h2>
            </div>
            <span className="extension-profile-badge">{tx("LOCAL FIRST", "本地优先")}</span>
          </div>
          <p>
            {tx(
              "Turn every new tab into an instant local Dockmark launcher. Cached bookmarks, Workspaces, search engines and open tabs appear before the network responds.",
              "将每个新标签页变为毫秒级本地启动台。缓存书签、工作区、搜索引擎与打开标签页即刻呈现，云端数据在后台静默刷新。",
            )}
          </p>
          <ul>
            <li>{tx("Instant extension-local startup — no redirect to your Workers URL.", "本地极速启动，无需跳转等待 Workers 响应。")}</li>
            <li>{tx("Last-known-good cache keeps search and launch working offline.", "本地快照缓存确保离线也可检索与启动。")}</li>
            <li>{tx("Includes all Browser Bridge, Session and reviewed bookmark sync features.", "包含完整的浏览器桥接、会话恢复与书签同步能力。")}</li>
          </ul>
          <div className="extension-actions">
            {newTabWebStoreUrl && (
              <button className="primary" type="button" onClick={() => external(newTabWebStoreUrl)}>
                {tx("Add Dockmark New Tab", "前往商店安装 New Tab")}
              </button>
            )}
            <button
              className={newTabWebStoreUrl ? "secondary" : "primary"}
              type="button"
              onClick={() => external(NEW_TAB_EXTENSION_DOWNLOAD_URL)}
            >
              {updateAvailable
                ? tx(`Download New Tab v${EXTENSION_RELEASE_VERSION}`, `下载 New Tab v${EXTENSION_RELEASE_VERSION}`)
                : tx("Download New Tab", "下载 New Tab 版")}
            </button>
          </div>
        </article>

        <article className="extension-profile">
          <div className="extension-profile-heading">
            <div>
              <span className="extension-profile-kicker">{tx("CHROMIUM · STANDARD", "CHROMIUM · 标准版")}</span>
              <h2>Dockmark Extension</h2>
            </div>
            <span className="extension-profile-badge">{tx("NEW TAB UNCHANGED", "保留默认新标签页")}</span>
          </div>
          <p>
            {tx(
              "Keep your browser's existing New Tab page while adding Dockmark's Browser Bridge and reviewed bookmark integration.",
              "保留浏览器原有新标签页，仅接入 Dockmark 浏览器桥接、弹窗收录与原生书签同步能力。",
            )}
          </p>
          <ul>
            <li>{tx("Never declares a browser New Tab override.", "不接管浏览器新标签页。")}</li>
            <li>{tx("Open tabs, Workspace reuse, Sessions and native bookmark mapping.", "支持实时标签页、工作区复用、会话恢复与书签映射。")}</li>
            <li>{tx("Manual Dockmark → Browser writeback only when explicitly triggered.", "仅在手动触发并确认时将变更回写到浏览器书签。")}</li>
          </ul>
          <div className="extension-actions">
            {webStoreUrl && (
              <button className="primary" type="button" onClick={() => external(webStoreUrl)}>
                {tx("Add Standard Extension", "前往商店安装标准版")}
              </button>
            )}
            <button
              className={webStoreUrl ? "secondary" : "primary"}
              type="button"
              onClick={() => external(EXTENSION_DOWNLOAD_URL)}
            >
              {updateAvailable || (!protocolCompatible && Boolean(status))
                ? tx(`Download Standard v${EXTENSION_RELEASE_VERSION}`, `下载标准版 v${EXTENSION_RELEASE_VERSION}`)
                : tx("Download Standard", "下载标准版")}
            </button>
          </div>
        </article>

        <article className="extension-profile extension-profile-firefox">
          <div className="extension-profile-heading">
            <div>
              <span className="extension-profile-kicker">{tx("FIREFOX · PREVIEW", "FIREFOX · 预览版")}</span>
              <h2>{tx("Dockmark Extension for Firefox", "Dockmark Firefox 扩展")}</h2>
            </div>
            <span className="extension-profile-badge">{tx("MV3 STANDARD", "MV3 标准版")}</span>
          </div>
          <p>
            {tx(
              "Targets Manifest V3 with dynamic per-origin authorization, preserving the same explicit permission model as Chromium Standard.",
              "基于 Manifest V3 构建，按站点显式授权桥接与可选权限，保持与 Chromium 标准版一致的安全模型。",
            )}
          </p>
          <ul>
            <li>{tx("Same open-tab, Workspace, Session and reviewed native-bookmark capabilities.", "完整支持标签页切换、工作区、会话与受审原生书签同步。")}</li>
            <li>{tx("Bookmark access stays optional; local-health host access stays explicit.", "原生书签权限按需开启，本地内网健康检查按主机单独授权。")}</li>
            <li>{tx("Standard profile only — does not override Firefox New Tab.", "当前为标准版，不覆盖 Firefox 默认新标签页。")}</li>
          </ul>
          <div className="extension-actions">
            <button className="primary" type="button" onClick={() => external(FIREFOX_EXTENSION_DOWNLOAD_URL)}>
              {tx(`Download Firefox v${EXTENSION_RELEASE_VERSION}`, `下载 Firefox 版 v${EXTENSION_RELEASE_VERSION}`)}
            </button>
          </div>
        </article>
      </section>

      <p className="extension-profile-note">
        {tx(
          "Install one Chromium profile only. When updating an unpacked build, replace files inside the same folder and click Reload in ",
          "Chromium 浏览器请仅安装其中一个版本。更新本地解压版时，请覆盖原目录文件并在 ",
        )}
        <code>chrome://extensions</code>
        {tx(
          " to keep extension ID, mappings and cache. The Firefox ZIP is an unsigned validation build for temporary loading via ",
          " 中点击「重新加载」，以保留扩展 ID、映射关系与本地缓存。Firefox ZIP 为未签名验证包，可通过 ",
        )}
        <code>about:debugging</code>
        {tx(".", " 临时加载。")}
      </p>

      {(guideOpen || !status) && (
        <article className="extension-guide form-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Manual installation", "手动安装步骤")}</h2>
              <p>{tx("Load the release ZIP in Chromium or Firefox.", "使用 GitHub Release ZIP 在 Chromium 或 Firefox 中加载。")}</p>
            </div>
            <a className="text-action" href={EXTENSION_RELEASE_URL} target="_blank" rel="noreferrer">
              {tx("Release page ↗", "发布页 ↗")}
            </a>
          </div>
          <div className="extension-guide-columns">
            <div>
              <h3>Chromium</h3>
              <ol>
                <li>
                  {tx("Download and unzip ", "下载并解压 ")}
                  <code>dockmark-newtab-chrome-v{EXTENSION_RELEASE_VERSION}.zip</code>
                  {tx(" or ", " 或 ")}
                  <code>dockmark-chrome-v{EXTENSION_RELEASE_VERSION}.zip</code>.
                </li>
                <li>
                  {tx("Open ", "打开 ")}
                  <code>chrome://extensions</code>
                  {tx(" in your browser.", " 扩展管理页面。")}
                </li>
                <li>
                  {tx("Enable Developer mode, click Load unpacked, and select the folder containing ", "开启「开发者模式」，点击「加载已解压的扩展程序」，选择包含 ")}
                  <code>manifest.json</code>
                  {tx(".", " 的文件夹。")}
                </li>
                <li>
                  {tx(
                    "Open the Dockmark popup, connect this origin, enter a pairing code, and optionally enable bookmark access.",
                    "打开 Dockmark 扩展弹窗，连接当前站点并填入配对码，按需开启书签访问权限。",
                  )}
                </li>
              </ol>
            </div>
            <div>
              <h3>{tx("Firefox preview", "Firefox 预览版")}</h3>
              <ol>
                <li>
                  {tx("Download and unzip ", "下载并解压 ")}
                  <code>dockmark-firefox-v{EXTENSION_RELEASE_VERSION}.zip</code>.
                </li>
                <li>
                  {tx("Open ", "打开 ")}
                  <code>about:debugging#/runtime/this-firefox</code>
                  {tx(" and click Load Temporary Add-on…", " 并点击「临时载入附加组件…」。")}
                </li>
                <li>
                  {tx("Select the extracted ", "选择解压后的 ")}
                  <code>manifest.json</code>
                  {tx(". Temporary add-ons reset when Firefox restarts.", "（Firefox 重启后需重新加载）。")}
                </li>
                <li>
                  {tx(
                    "Set this Dockmark origin in the popup, approve site access, and enable optional permissions as needed.",
                    "在弹窗中配置当前 Dockmark 地址、批准站点访问并按需开启可选权限。",
                  )}
                </li>
              </ol>
            </div>
          </div>
        </article>
      )}

      <BrowserSettingsManager />

      <div className="extension-diagnostics-grid">
        <article className="form-card extension-diagnostic-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Connection", "连接诊断")}</h2>
              <p>{tx("Live handshake between this Dockmark origin and the extension.", "当前页面与浏览器扩展之间的实时握手状态。")}</p>
            </div>
          </div>
          <dl className="diagnostic-list">
            <div>
              <dt>{tx("Current Dockmark origin", "当前站点来源")}</dt>
              <dd>{window.location.origin}</dd>
            </div>
            <div>
              <dt>{tx("Extension", "扩展版本")}</dt>
              <dd>{status ? `v${status.extensionVersion}` : tx("Not detected", "未检测到")}</dd>
            </div>
            <div>
              <dt>{tx("Bridge protocol", "桥接协议")}</dt>
              <dd>{status ? `${status.protocolVersion} / Web ${BRIDGE_PROTOCOL_VERSION}` : `Web ${BRIDGE_PROTOCOL_VERSION}`}</dd>
            </div>
            <div>
              <dt>{tx("Compatibility", "兼容性")}</dt>
              <dd>
                {status
                  ? protocolCompatible
                    ? tx("Compatible", "兼容")
                    : tx("Update required", "需要更新")
                  : tx("Waiting for extension", "等待扩展连接")}
              </dd>
            </div>
            <div>
              <dt>{tx("Native bookmark permission", "原生书签权限")}</dt>
              <dd>
                {status?.permissions?.nativeBookmarks
                  ? tx("Granted", "已授权")
                  : status
                    ? tx("Not granted", "未授权")
                    : tx("Unavailable", "不可用")}
              </dd>
            </div>
          </dl>
          {error && <p className="extension-diagnostic-note">{error}</p>}
        </article>

        <article className="form-card extension-diagnostic-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Capabilities", "可用能力")}</h2>
              <p>{tx("Reported directly by the connected extension.", "由已连接的扩展实时上报的能力清单。")}</p>
            </div>
          </div>
          <div className="capability-list">
            {capabilityLabels.map(([key, label]) => {
              const enabled = Boolean(status?.capabilities[key]);
              return (
                <div key={key}>
                  <span>{label}</span>
                  <strong className={enabled ? "capability-on" : "capability-off"}>
                    {enabled ? tx("Available", "可用") : status ? tx("Not available", "不可用") : "—"}
                  </strong>
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </section>
  );
}
