/**
 * Intercept navigations:
 * - Same normalized page (origin + path + sorted query + hash): duplicate interstitial.
 * - Same hostname with 3+ tabs (after this navigation): occasional consolidation offer (throttled).
 */

import {
  DEFAULT_COOLDOWN_MS,
  REARM_GROWTH,
  evaluateConsolidationPitch,
} from "./cooldown.mjs";

const INTERSTITIAL_PAGE = "src/interstitial.html";
const EXT_PREFIX = chrome.runtime.getURL("");

const inFlight = new Map();
/** Last committed top-level http(s) URL per tab (for same-site duplicate bypass). */
const lastCommittedHttpUrlByTab = new Map();

/**
 * Per-host survivors after popup consolidation. The active tab is always kept (when it
 * belongs to a cluster); the rest of the survivors are the most-recently-accessed.
 * Tunable here, not in user settings — the point of consolidation is decisiveness.
 */
const KEEP_PER_HOST = 2;

function isHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isExtensionUrl(url) {
  return typeof url === "string" && url.startsWith(EXT_PREFIX);
}

function hostnameOf(url) {
  return new URL(url).hostname;
}

/**
 * If the user was already on this host before this navigation, treat duplicate URL hits
 * as normal in-site navigation (e.g. cart link on Amazon) and do not show the interstitial.
 *
 * Uses the last committed main-frame URL; hostname match only (not eTLD+1 — www vs apex
 * or sibling subdomains still look "cross-site" here).
 */
function shouldSkipDuplicateInterstitialForSameSiteNavigation(tabId, targetUrl) {
  const prior = lastCommittedHttpUrlByTab.get(tabId);
  if (!prior || !isHttpUrl(prior) || isExtensionUrl(prior)) return false;
  try {
    return hostnameOf(prior).toLowerCase() === hostnameOf(targetUrl).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Same "page" key: protocol + hostname + path (no trailing slash except root) +
 * sorted query string + hash (exact).
 */
function normalizeUrlKey(url) {
  const u = new URL(url);
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const entries = [...u.searchParams.entries()].sort((a, b) => {
    const cmp = a[0].localeCompare(b[0]);
    if (cmp !== 0) return cmp;
    return String(a[1]).localeCompare(String(b[1]));
  });
  const sp = new URLSearchParams(entries);
  const q = sp.toString();
  const frag = u.hash || "";
  return `${u.protocol}//${u.hostname}${path}${q ? `?${q}` : ""}${frag}`;
}

function bypassKey(tabId) {
  return `bypass_${tabId}`;
}

async function hasBypass(tabId, host) {
  const data = await chrome.storage.session.get(bypassKey(tabId));
  const b = data[bypassKey(tabId)];
  if (!b) return false;
  if (b.host !== host) return false;
  if (Date.now() > b.expires) {
    await chrome.storage.session.remove(bypassKey(tabId));
    return false;
  }
  return true;
}

async function setBypass(tabId, host, ms = 60000) {
  await chrome.storage.session.set({
    [bypassKey(tabId)]: { host, expires: Date.now() + ms },
  });
}

function hostOfTab(t) {
  if (!t.url || !isHttpUrl(t.url) || isExtensionUrl(t.url)) return null;
  return hostnameOf(t.url);
}

/**
 * URL to use when detecting “same page” as another tab: prefer in-flight navigation target.
 */
function tabUrlForPageMatch(t) {
  const p = t.pendingUrl;
  if (typeof p === "string" && p.length > 0 && isHttpUrl(p) && !isExtensionUrl(p)) {
    return p;
  }
  const u = t.url;
  if (typeof u === "string" && u.length > 0) return u;
  return null;
}

/**
 * How many tabs will be on targetHostname after this navigation completes?
 * The navigating tab counts as belonging to targetHostname for this estimate.
 */
function countTabsForHostnameAfterNavigation(allTabs, navigatingTabId, targetHostname) {
  let n = 0;
  for (const t of allTabs) {
    if (t.id == null) continue;
    const h = t.id === navigatingTabId ? targetHostname : hostOfTab(t);
    if (h === targetHostname) n++;
  }
  return n;
}

async function findSamePageDuplicates(tabId, targetUrl) {
  const key = normalizeUrlKey(targetUrl);
  const tabs = await chrome.tabs.query({});
  const dups = [];

  for (const t of tabs) {
    if (t.id === tabId) continue;
    const u = tabUrlForPageMatch(t);
    if (!u || !isHttpUrl(u) || isExtensionUrl(u)) continue;
    if (normalizeUrlKey(u) !== key) continue;
    dups.push({
      id: t.id,
      windowId: t.windowId,
      index: t.index ?? 0,
      title: t.title || u,
      url: u,
      favIconUrl: t.favIconUrl || "",
      lastAccessed: t.lastAccessed ?? 0,
      pinned: !!t.pinned,
    });
  }

  dups.sort((a, b) => {
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    if (a.index !== b.index) return a.index - b.index;
    return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
  });
  return dups;
}

async function shouldOfferConsolidation(hostname, currentTabCount) {
  const storageKey = `consolidate_pitch_${hostname}`;
  const [{ [storageKey]: prior }, settings] = await Promise.all([
    chrome.storage.session.get(storageKey),
    getSettings(),
  ]);
  return evaluateConsolidationPitch({
    prior: prior ?? null,
    currentCount: currentTabCount,
    cooldownMs: settings.consolidateCooldownMs,
    now: Date.now(),
  });
}

async function recordConsolidationPitch(hostname, count) {
  await chrome.storage.session.set({
    [`consolidate_pitch_${hostname}`]: { at: Date.now(), count },
  });
}

/**
 * Read user settings from chrome.storage.local. Defensive against missing or
 * malformed payloads — always returns a fully-populated settings object so
 * callers never have to null-check fields.
 */
async function getSettings() {
  try {
    const data = await chrome.storage.local.get("settings");
    const raw = data?.settings ?? {};
    const cooldownMs =
      typeof raw.consolidateCooldownMs === "number" && raw.consolidateCooldownMs >= 0
        ? raw.consolidateCooldownMs
        : DEFAULT_COOLDOWN_MS;
    return { consolidateCooldownMs: cooldownMs };
  } catch {
    return { consolidateCooldownMs: DEFAULT_COOLDOWN_MS };
  }
}

/**
 * Build a duplicate-by-hostname consolidation plan. For each hostname with more than
 * KEEP_PER_HOST eligible tabs, keep the top survivors and close the rest.
 *
 * Survivor ranking, highest priority first:
 *   1. preferTabId (the active tab) — always kept when it belongs to a cluster.
 *   2. Most-recently-accessed (descending).
 *   3. Lower tab id (stable tie-break).
 */
function buildConsolidationPlan(allTabs, preferTabId) {
  const eligible = allTabs.filter(
    (t) => t.id != null && t.url && isHttpUrl(t.url) && !isExtensionUrl(t.url),
  );

  /** @type {Map<string, chrome.tabs.Tab[]>} */
  const byHost = new Map();
  for (const t of eligible) {
    const h = hostnameOf(t.url);
    let g = byHost.get(h);
    if (!g) {
      g = [];
      byHost.set(h, g);
    }
    g.push(t);
  }

  const toClose = [];
  const hosts = [];

  for (const [_host, group] of byHost) {
    if (group.length <= KEEP_PER_HOST) continue;

    const ranked = [...group].sort((a, b) => {
      if (preferTabId != null) {
        if (a.id === preferTabId) return -1;
        if (b.id === preferTabId) return 1;
      }
      const la = a.lastAccessed ?? 0;
      const lb = b.lastAccessed ?? 0;
      if (la !== lb) return lb - la;
      return a.id - b.id;
    });

    const keepers = new Set(ranked.slice(0, KEEP_PER_HOST).map((t) => t.id));
    for (const t of group) {
      if (!keepers.has(t.id)) toClose.push(t.id);
    }
    hosts.push(hostnameOf(group[0].url));
  }

  return {
    toClose,
    closedCount: toClose.length,
    hostCount: hosts.length,
    hosts,
  };
}

/** All http(s) tab ids on hostname (for “consolidate into this navigation” from interstitial). */
function httpTabIdsForHostname(allTabs, hostname) {
  return allTabs
    .filter(
      (t) =>
        t.id != null &&
        t.url &&
        isHttpUrl(t.url) &&
        !isExtensionUrl(t.url) &&
        hostnameOf(t.url) === hostname,
    )
    .map((t) => t.id);
}

async function showDuplicateInterstitial(tabId, url, dupes) {
  const k = crypto.randomUUID();
  const storageKey = `dup_${k}`;
  const ttlMs = 5 * 60 * 1000;
  await chrome.storage.session.set({
    [storageKey]: {
      kind: "duplicate",
      targetUrl: url,
      duplicates: dupes,
      tabId,
      created: Date.now(),
    },
  });

  setTimeout(() => {
    chrome.storage.session.remove(storageKey);
  }, ttlMs);

  await chrome.tabs.update(tabId, {
    url: `${chrome.runtime.getURL(INTERSTITIAL_PAGE)}?k=${encodeURIComponent(k)}`,
  });
}

async function showConsolidateInterstitial(tabId, pendingUrl, hostname, tabCount) {
  const c = crypto.randomUUID();
  const storageKey = `consolidate_${c}`;
  const ttlMs = 5 * 60 * 1000;
  await chrome.storage.session.set({
    [storageKey]: {
      kind: "consolidate",
      pendingUrl,
      hostname,
      tabCount,
      tabId,
      created: Date.now(),
    },
  });

  setTimeout(() => {
    chrome.storage.session.remove(storageKey);
  }, ttlMs);

  await recordConsolidationPitch(hostname, tabCount);

  await chrome.tabs.update(tabId, {
    url: `${chrome.runtime.getURL(INTERSTITIAL_PAGE)}?c=${encodeURIComponent(c)}`,
  });
}

async function maybeIntercept(tabId, url, _source) {
  if (!isHttpUrl(url) || isExtensionUrl(url)) return;
  const host = hostnameOf(url);
  if (await hasBypass(tabId, host)) return;

  const now = Date.now();
  if (inFlight.get(tabId) && now - inFlight.get(tabId) < 800) return;
  inFlight.set(tabId, now);

  try {
    let t;
    try {
      t = await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    if (t.pendingUrl && isExtensionUrl(t.pendingUrl)) return;
    if (t.url && isExtensionUrl(t.url)) return;

    const dupes = await findSamePageDuplicates(tabId, url);
    if (dupes.length > 0) {
      if (shouldSkipDuplicateInterstitialForSameSiteNavigation(tabId, url)) {
        return;
      }
      await showDuplicateInterstitial(tabId, url, dupes);
      return;
    }

    const allTabs = await chrome.tabs.query({});
    const tabCount = countTabsForHostnameAfterNavigation(allTabs, tabId, host);
    if (tabCount >= 3 && (await shouldOfferConsolidation(host, tabCount))) {
      await showConsolidateInterstitial(tabId, url, host, tabCount);
    }
  } finally {
    setTimeout(() => {
      const ts = inFlight.get(tabId);
      if (ts === now) inFlight.delete(tabId);
    }, 500);
  }
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const u = details.url;
  if (isExtensionUrl(u)) return;
  if (!isHttpUrl(u)) {
    lastCommittedHttpUrlByTab.delete(details.tabId);
    return;
  }
  lastCommittedHttpUrlByTab.set(details.tabId, u);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastCommittedHttpUrlByTab.delete(tabId);
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  void maybeIntercept(details.tabId, details.url, "beforeNavigate");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") return;
  const url = changeInfo.url ?? tab.url;
  if (!url) return;
  void maybeIntercept(tabId, url, "updated");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "tabby-focus-tab") {
    const { tabId: targetTabId } = msg;
    void (async () => {
      try {
        const tab = await chrome.tabs.get(targetTabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(targetTabId, { active: true });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "tabby-bypass-and-go") {
    const { tabId, targetUrl } = msg;
    void (async () => {
      try {
        await setBypass(tabId, hostnameOf(targetUrl));
        await chrome.tabs.update(tabId, { url: targetUrl });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "tabby-close-tab") {
    const { tabId } = msg;
    void (async () => {
      try {
        await chrome.tabs.remove(tabId);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "tabby-consolidate-host-and-go") {
    const { tabId: navTabId, hostname, pendingUrl } = msg;
    void (async () => {
      try {
        const allTabs = await chrome.tabs.query({});
        const toClose = httpTabIdsForHostname(allTabs, hostname);
        if (toClose.length > 0) {
          await chrome.tabs.remove(toClose);
        }
        await setBypass(navTabId, hostnameOf(pendingUrl));
        await chrome.tabs.update(navTabId, { url: pendingUrl });
        sendResponse({ ok: true, closedCount: toClose.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "tabby-consolidate") {
    const dryRun = Boolean(msg.dryRun);
    const preferTabId =
      typeof msg.preferTabId === "number" && Number.isFinite(msg.preferTabId)
        ? msg.preferTabId
        : undefined;

    void (async () => {
      try {
        const allTabs = await chrome.tabs.query({});
        const plan = buildConsolidationPlan(allTabs, preferTabId);
        let undoSessionIds = [];
        if (!dryRun && plan.toClose.length > 0) {
          await chrome.tabs.remove(plan.toClose);
          undoSessionIds = await captureClosedSessionIds(plan.toClose.length);
        }
        sendResponse({
          ok: true,
          dryRun,
          closedCount: plan.closedCount,
          hostCount: plan.hostCount,
          hosts: plan.hosts,
          undoSessionIds,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "tabby-undo-consolidate") {
    const sessionIds = Array.isArray(msg.sessionIds) ? msg.sessionIds : [];
    void (async () => {
      try {
        let restored = 0;
        for (const id of sessionIds) {
          try {
            await chrome.sessions.restore(id);
            restored++;
          } catch {
            /* session may have aged out — keep going */
          }
        }
        sendResponse({ ok: true, restored });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});

/**
 * Pull the N most recent tab entries from chrome.sessions and return their sessionIds.
 * Called immediately after a batch close, so the closed tabs are at the head of the list.
 * A small delay gives Chrome a moment to register the closures in the sessions log.
 */
async function captureClosedSessionIds(expected) {
  await new Promise((r) => setTimeout(r, 80));
  let recent;
  try {
    recent = await chrome.sessions.getRecentlyClosed({ maxResults: expected + 5 });
  } catch {
    return [];
  }
  const ids = [];
  for (const item of recent) {
    const sessionId = item.tab?.sessionId;
    if (!sessionId) continue;
    ids.push(sessionId);
    if (ids.length >= expected) break;
  }
  return ids;
}
