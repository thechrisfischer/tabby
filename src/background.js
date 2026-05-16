/**
 * Intercept navigations to an https? URL whose hostname already exists on another tab.
 * Uses an extension interstitial + session storage (payload may be large).
 */

const INTERSTITIAL_PAGE = "src/interstitial.html";
const EXT_PREFIX = chrome.runtime.getURL("");

const inFlight = new Map();

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

async function findDuplicates(tabId, targetUrl) {
  const host = hostnameOf(targetUrl);
  const tabs = await chrome.tabs.query({});
  const dups = [];

  for (const t of tabs) {
    if (t.id === tabId) continue;
    if (!t.url || !isHttpUrl(t.url)) continue;
    if (isExtensionUrl(t.url)) continue;
    if (hostnameOf(t.url) !== host) continue;
    dups.push({
      id: t.id,
      windowId: t.windowId,
      index: t.index,
      title: t.title || t.url,
      url: t.url,
      lastAccessed: t.lastAccessed ?? 0,
    });
  }

  dups.sort((a, b) => b.lastAccessed - a.lastAccessed);
  return dups;
}

/**
 * Build a duplicate-by-hostname consolidation plan. For each hostname with 2+ eligible
 * tabs, keep one tab and close the rest. Keeper preference: preferTabId if it is in the
 * group; otherwise highest lastAccessed (ties: lower tab id).
 * @param {number|undefined} preferTabId - e.g. active tab in the window that opened the popup
 * @returns {{ toClose: number[], closedCount: number, hostCount: number, hosts: string[] }}
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

  for (const [host, group] of byHost) {
    if (group.length < 2) continue;

    const preferred = preferTabId != null ? group.find((t) => t.id === preferTabId) : null;
    let keeper = preferred;

    if (!keeper) {
      keeper = group[0];
      for (const t of group) {
        const a = t.lastAccessed ?? 0;
        const b = keeper.lastAccessed ?? 0;
        if (a > b || (a === b && t.id < keeper.id)) keeper = t;
      }
    }

    for (const t of group) {
      if (t.id !== keeper.id) toClose.push(t.id);
    }
    hosts.push(host);
  }

  return {
    toClose,
    closedCount: toClose.length,
    hostCount: hosts.length,
    hosts,
  };
}

async function maybeIntercept(tabId, url, _source) {
  if (!isHttpUrl(url) || isExtensionUrl(url)) return;
  if (await hasBypass(tabId, hostnameOf(url))) return;

  const dupes = await findDuplicates(tabId, url);
  if (dupes.length === 0) return;

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

    const k = crypto.randomUUID();
    const storageKey = `dup_${k}`;
    const ttlMs = 5 * 60 * 1000;
    await chrome.storage.session.set({
      [storageKey]: {
        targetUrl: url,
        duplicates: dupes,
        tabId,
        created: Date.now(),
      },
    });

    // Self-expire storage (session storage has no native TTL)
    setTimeout(() => {
      chrome.storage.session.remove(storageKey);
    }, ttlMs);

    await chrome.tabs.update(tabId, {
      url: `${chrome.runtime.getURL(INTERSTITIAL_PAGE)}?k=${encodeURIComponent(k)}`,
    });
  } finally {
    setTimeout(() => {
      const ts = inFlight.get(tabId);
      if (ts === now) inFlight.delete(tabId);
    }, 500);
  }
}

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
        if (!dryRun && plan.toClose.length > 0) {
          await chrome.tabs.remove(plan.toClose);
        }
        sendResponse({
          ok: true,
          dryRun,
          closedCount: plan.closedCount,
          hostCount: plan.hostCount,
          hosts: plan.hosts,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
});
