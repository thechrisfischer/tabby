function qs(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function parseParams() {
  const u = new URL(location.href);
  return { k: u.searchParams.get("k"), c: u.searchParams.get("c") };
}

/** @type {null | { kind: 'duplicate'; targetUrl: string; duplicates: any[]; tabId: number }} */
let dupState = null;
/** @type {null | { kind: 'consolidate'; pendingUrl: string; hostname: string; tabCount: number; tabId: number }} */
let conState = null;

let dupRovingIndex = 0;
/** When the highlight is on a non-tab row, Left still resumes the last tab row you had highlighted. */
let lastTabDupRovingIndex = 0;
/** Escape hides the duplicate choices card; Escape again restores it (hotkeys keep working). */
let dupDialogCollapsed = false;

/** Invalidates in-flight tab preview fetches when hiding or switching hover target. */
let tabThumbRequestSerial = 0;

/** @type {Map<string, { description: string | null; siteName: string | null; documentTitle: string | null; documentTitleCompare: string | null; canonicalHref: string | null }>} */
const pageSnippetCache = new Map();

/**
 * Same "page" key as background duplicate detection: origin + normalized path +
 * sorted query + hash — used to hide redundant canonical lines.
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

function titlesDiffer(tabTitle, documentTitle) {
  const a = tabTitle.replace(/\s+/g, " ").trim().toLowerCase();
  const b = documentTitle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!b) return false;
  return a !== b;
}

/** FNV-1a 32-bit — stable hash for interstitial session ids (`k` / `c`). */
function fnv1a32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Must match `src/interstitial-hero-boot.js` and `src/heroes.json` (single source of truth). */
const HERO_EMBEDDED = {
  files: [
    "bg-01.jpg",
    "bg-02.jpg",
    "bg-03.jpg",
    "bg-04.jpg",
    "bg-05.jpg",
    "bg-06.jpg",
    "bg-07.jpg",
    "bg-08.jpg",
    "bg-09.jpg",
    "bg-10.jpg",
  ],
  positions: [
    "center 35%",
    "center 28%",
    "62% 38%",
    "38% 48%",
    "center 42%",
    "72% 32%",
    "28% 36%",
    "center 22%",
    "55% 40%",
    "48% 55%",
  ],
};

const HERO_SEED_STORAGE_KEY = "tabby-hero-seed-fallback";

/**
 * Hero backdrop seed: one stable look per interstitial invocation (`?k=` / `?c=` UUID).
 * Same URL on refresh → same seed. New invocation → new UUID → new hero.
 * If the URL has no session param, use a per-tab-session value so refresh still matches.
 *
 * Keep in sync with `interstitial-hero-boot.js` (same formula + storage key).
 */
function heroSeedFromInvocation(k, c) {
  const param = (k || c || "").trim();
  if (param) return fnv1a32(param);
  try {
    let stored = sessionStorage.getItem(HERO_SEED_STORAGE_KEY);
    if (!stored) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      stored = String(buf[0] >>> 0);
      sessionStorage.setItem(HERO_SEED_STORAGE_KEY, stored);
    }
    return Number(stored) >>> 0;
  } catch {
    return 104729;
  }
}

function randomSignalIndex(length) {
  if (length <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % length;
}

/**
 * Hero art: bundled files under src/assets + crop positions from heroes.json.
 * `seed` comes from the interstitial session (stable across refresh for that URL).
 */
function heroPick(config, seed) {
  const files = config?.files?.length ? config.files : HERO_EMBEDDED.files;
  const positions = config?.positions?.length ? config.positions : HERO_EMBEDDED.positions;
  const s = (seed >>> 0) || 0;
  const fileIx = s % files.length;
  const posIx = ((s * 5011 + 17) >>> 0) % positions.length;
  return { file: files[fileIx], position: positions[posIx] };
}

async function loadSignals() {
  const url = chrome.runtime.getURL("src/signals.json");
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return /** @type {Array<{ lines: string[]; by: string }>} */ (await res.json());
  } catch {
    return null;
  }
}

async function loadHeroConfig() {
  const url = chrome.runtime.getURL("src/heroes.json");
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    const raw = /** @type {unknown} */ (await res.json());
    return normalizeHeroConfig(raw);
  } catch {
    return null;
  }
}

/**
 * Ignore corrupt/truncated JSON (e.g. bad cache) so we never shrink the file list vs boot.
 * Boot uses the embedded lists; modulo must stay consistent or the hero swaps on refresh.
 */
function normalizeHeroConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  const files = /** @type {{ files?: unknown; positions?: unknown }} */ (raw).files;
  const positions = /** @type {{ files?: unknown; positions?: unknown }} */ (raw).positions;
  if (!Array.isArray(files) || !Array.isArray(positions)) return null;
  if (
    files.length < HERO_EMBEDDED.files.length ||
    positions.length < HERO_EMBEDDED.positions.length
  ) {
    return null;
  }
  return { files: /** @type {string[]} */ (files), positions: /** @type {string[]} */ (positions) };
}

function heroListsEqual(a, b) {
  if (!a?.files?.length || !b?.files?.length) return false;
  if (!a.positions?.length || !b.positions?.length) return false;
  if (a.files.length !== b.files.length || a.positions.length !== b.positions.length) return false;
  return a.files.every((f, i) => f === b.files[i]) && a.positions.every((p, i) => p === b.positions[i]);
}

function applyHeroBackdrop(config, seed) {
  const img = document.getElementById("backdrop-img");
  if (!img) return;

  const fetched = config?.files?.length ? config : null;
  const booted = Boolean(img.dataset.tabbyHeroFile);

  // Boot already ran; fetched JSON matches bundled defaults — never touch the image again.
  // Re-assigning src / styles here can re-decode and flash on later reloads (cache timing).
  if (booted && (!fetched || heroListsEqual(fetched, HERO_EMBEDDED))) {
    return;
  }

  // Boot ran with embedded lists, but heroes.json is a strict superset — re-pick once.
  const merged = fetched ?? HERO_EMBEDDED;
  const { file, position } = heroPick(merged, seed);
  const url = chrome.runtime.getURL(`src/assets/${file}`);
  if (img.dataset.tabbyHeroFile === file && img.dataset.tabbyHeroPos === position) return;
  if (img.src === url) {
    img.style.objectPosition = position;
    img.dataset.tabbyHeroFile = file;
    img.dataset.tabbyHeroPos = position;
    return;
  }
  img.src = url;
  img.style.objectPosition = position;
  img.dataset.tabbyHeroFile = file;
  img.dataset.tabbyHeroPos = position;
}

function renderQuote(entry) {
  const l1 = document.getElementById("quote-l1");
  const l2 = document.getElementById("quote-l2");
  const by = document.getElementById("quote-by");
  if (!l1 || !l2 || !by || !entry) return;
  const [a = "", b = ""] = entry.lines || [];
  l1.textContent = a;
  l2.textContent = b;
  l2.style.display = b ? "" : "none";
  by.textContent = entry.by ? `— ${entry.by}` : "";
}

function setFootnote(text) {
  const el = document.getElementById("footnote");
  if (el) el.textContent = text;
}

function showMode(mode) {
  const dup = document.getElementById("panel-dup");
  const con = document.getElementById("panel-con");
  if (dup) dup.hidden = mode !== "duplicate";
  if (con) con.hidden = mode !== "consolidate";
}

function syncTabThumbFromKeyboard() {
  const n = dupState?.duplicates?.length ?? 0;
  if (!dupState || n === 0) {
    hideTabThumbPreview();
    return;
  }
  if (dupRovingIndex >= 2 && dupRovingIndex <= n + 1) {
    void showTabLinkPreview(dupState.duplicates[dupRovingIndex - 2]);
  } else {
    hideTabThumbPreview();
  }
}

function clipMetaText(s, max) {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function formatTabRecency(lastAccessed) {
  if (!lastAccessed) return "";
  const sec = Math.round((Date.now() - lastAccessed) / 1000);
  if (sec < 45) return "Last focused just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const min = Math.round(sec / 60);
  if (min < 60) return `Last focused ${rtf.format(-min, "minute")}`;
  const hr = Math.round(min / 60);
  if (hr < 36) return `Last focused ${rtf.format(-hr, "hour")}`;
  const day = Math.round(hr / 24);
  if (day < 21) return `Last focused ${rtf.format(-day, "day")}`;
  return `Last focused ${new Date(lastAccessed).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function tabContextLine(d) {
  const parts = [];
  if (d.pinned) parts.push("Pinned");
  const rec = formatTabRecency(d.lastAccessed);
  if (rec) parts.push(rec);
  return parts.join(" · ");
}

async function fetchPageSnippetForPage(pageUrl) {
  if (pageSnippetCache.has(pageUrl)) return pageSnippetCache.get(pageUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(pageUrl, {
      signal: ctrl.signal,
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      const miss = { description: null, siteName: null, documentTitle: null, documentTitleCompare: null, canonicalHref: null };
      pageSnippetCache.set(pageUrl, miss);
      return miss;
    }
    const text = await res.text();
    const snippet = text.slice(0, 400_000);
    const doc = new DOMParser().parseFromString(snippet, "text/html");
    const rawDesc =
      doc.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="twitter:description"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="description"]')?.getAttribute("content");
    const rawSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    const rawTitle = doc.querySelector("title")?.textContent;
    const titleTrim = rawTitle ? rawTitle.replace(/\s+/g, " ").trim() : "";
    const documentTitle = titleTrim ? clipMetaText(titleTrim, 200) : null;
    const rawCanon = doc.querySelector('link[rel~="canonical"][href]')?.getAttribute("href");
    let canonicalHref = null;
    if (rawCanon) {
      try {
        canonicalHref = new URL(rawCanon.trim(), pageUrl).href;
      } catch {
        canonicalHref = null;
      }
    }
    const description = rawDesc ? clipMetaText(rawDesc, 240) : null;
    const siteName = rawSite ? clipMetaText(rawSite, 80) : null;
    const out = { description, siteName, documentTitle, documentTitleCompare: titleTrim || null, canonicalHref };
    pageSnippetCache.set(pageUrl, out);
    return out;
  } catch {
    const miss = { description: null, siteName: null, documentTitle: null, documentTitleCompare: null, canonicalHref: null };
    pageSnippetCache.set(pageUrl, miss);
    return miss;
  } finally {
    clearTimeout(timer);
  }
}

function hostInitialFromUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./i, "");
    const ch = h[0];
    return ch ? ch.toUpperCase() : "?";
  } catch {
    return "?";
  }
}

/**
 * Preview for duplicate **tab rows** only: favicon, title, tab signals (pinned / last focused),
 * plus HTML title / canonical / meta description when they add information beyond the tab row.
 */
async function showTabLinkPreview(d) {
  const wrap = document.getElementById("tab-thumb");
  const img = document.getElementById("tab-thumb-img");
  const initial = document.getElementById("tab-thumb-initial");
  const title = document.getElementById("tab-thumb-title");
  const recency = document.getElementById("tab-thumb-recency");
  const liveTitleEl = document.getElementById("tab-thumb-live-title");
  const canonicalEl = document.getElementById("tab-thumb-canonical");
  const descEl = document.getElementById("tab-thumb-desc");
  if (!wrap || !img || !initial || !title || !recency || !liveTitleEl || !canonicalEl || !descEl || !d) return;

  const serial = ++tabThumbRequestSerial;

  title.textContent = d.title || d.url || "";
  const ctx = tabContextLine(d);
  if (ctx) {
    recency.textContent = ctx;
    recency.hidden = false;
  } else {
    recency.textContent = "";
    recency.hidden = true;
  }
  liveTitleEl.textContent = "";
  liveTitleEl.hidden = true;
  canonicalEl.textContent = "";
  canonicalEl.hidden = true;
  descEl.textContent = "";
  descEl.hidden = true;

  wrap.hidden = false;
  wrap.classList.add("tab-thumb--loading");
  img.removeAttribute("src");
  img.hidden = true;
  initial.hidden = true;

  if (d.favIconUrl) {
    img.onload = () => {
      if (serial !== tabThumbRequestSerial) return;
      img.hidden = false;
      initial.hidden = true;
    };
    img.onerror = () => {
      if (serial !== tabThumbRequestSerial) return;
      img.hidden = true;
      initial.textContent = hostInitialFromUrl(d.url || "");
      initial.hidden = false;
    };
    img.src = d.favIconUrl;
  } else {
    img.onload = null;
    img.onerror = null;
    img.hidden = true;
    initial.textContent = hostInitialFromUrl(d.url || "");
    initial.hidden = false;
  }

  const pageUrl = d.url || "";
  if (!pageUrl) {
    wrap.classList.remove("tab-thumb--loading");
    return;
  }

  const { description, siteName, documentTitle, documentTitleCompare, canonicalHref } = await fetchPageSnippetForPage(pageUrl);
  if (serial !== tabThumbRequestSerial) return;
  wrap.classList.remove("tab-thumb--loading");

  const tabTitleForCompare = d.title || "";
  if (documentTitleCompare && titlesDiffer(tabTitleForCompare, documentTitleCompare) && documentTitle) {
    liveTitleEl.textContent = `Live title: ${documentTitle}`;
    liveTitleEl.hidden = false;
  }

  if (canonicalHref) {
    try {
      if (normalizeUrlKey(canonicalHref) !== normalizeUrlKey(pageUrl)) {
        canonicalEl.textContent = `Canonical: ${canonicalHref}`;
        canonicalEl.hidden = false;
      }
    } catch {
      /* ignore */
    }
  }

  let descText = "";
  if (description) {
    const dn = description.toLowerCase();
    const sn = siteName?.toLowerCase() ?? "";
    descText =
      siteName && sn && !dn.startsWith(sn) && !dn.startsWith(`${sn} —`) ? `${siteName} — ${description}` : description;
  } else if (siteName) {
    descText = siteName;
  }
  if (descText) {
    descEl.textContent = descText;
    descEl.hidden = false;
  }
}

function hideTabThumbPreview() {
  tabThumbRequestSerial++;
  const wrap = document.getElementById("tab-thumb");
  const img = document.getElementById("tab-thumb-img");
  const recency = document.getElementById("tab-thumb-recency");
  const liveTitleEl = document.getElementById("tab-thumb-live-title");
  const canonicalEl = document.getElementById("tab-thumb-canonical");
  const descEl = document.getElementById("tab-thumb-desc");
  const title = document.getElementById("tab-thumb-title");
  if (img) {
    img.removeAttribute("src");
    img.onload = null;
    img.onerror = null;
  }
  if (title) title.textContent = "";
  if (recency) {
    recency.textContent = "";
    recency.hidden = true;
  }
  if (liveTitleEl) {
    liveTitleEl.textContent = "";
    liveTitleEl.hidden = true;
  }
  if (canonicalEl) {
    canonicalEl.textContent = "";
    canonicalEl.hidden = true;
  }
  if (descEl) {
    descEl.textContent = "";
    descEl.hidden = true;
  }
  if (wrap) {
    wrap.hidden = true;
    wrap.classList.remove("tab-thumb--loading");
  }
}

function dupOptionCount() {
  if (!dupState?.duplicates) return 0;
  return dupState.duplicates.length + 3;
}

function renderDuplicateOptions() {
  const listEl = qs("list");
  const hostEl = qs("host");
  if (!dupState) {
    hostEl.textContent = "—";
    listEl.innerHTML = "";
    hideTabThumbPreview();
    return;
  }

  const host = new URL(dupState.targetUrl).hostname;
  hostEl.textContent = host;

  const n = dupState.duplicates.length;
  const total = n + 3;
  if (dupRovingIndex >= total) dupRovingIndex = Math.max(0, total - 1);
  if (dupRovingIndex >= 2 && dupRovingIndex <= n + 1) {
    lastTabDupRovingIndex = dupRovingIndex - 2;
  }

  listEl.replaceChildren();

  const continueIx = 0;
  const continueLi = document.createElement("li");
  continueLi.className = "item item--action item--continue" + (dupRovingIndex === continueIx ? " selected" : "");
  continueLi.id = "dup-opt-continue";
  continueLi.setAttribute("role", "option");
  continueLi.setAttribute("aria-selected", dupRovingIndex === continueIx ? "true" : "false");
  continueLi.dataset.kind = "continue";
  continueLi.innerHTML = `
    <span class="item-index" aria-hidden="true">·</span>
    <div class="item-body">
      <div class="item-title">Open new tab</div>
    </div>
    <div class="item-keys" aria-hidden="true">
      <kbd class="item-kbd">→</kbd>
    </div>
  `;
  continueLi.addEventListener("click", () => {
    dupRovingIndex = continueIx;
    renderDuplicateOptions();
    void openNewAnyway();
  });
  listEl.appendChild(continueLi);

  const resumeIx = 1;
  const resumeLi = document.createElement("li");
  resumeLi.className = "item item--action item--resume" + (dupRovingIndex === resumeIx ? " selected" : "");
  resumeLi.id = "dup-opt-resume";
  resumeLi.setAttribute("role", "option");
  resumeLi.setAttribute("aria-selected", dupRovingIndex === resumeIx ? "true" : "false");
  resumeLi.dataset.kind = "resume";
  resumeLi.innerHTML = `
    <span class="item-index" aria-hidden="true">·</span>
    <div class="item-body">
      <div class="item-title">Go to previous tab</div>
    </div>
    <div class="item-keys" aria-hidden="true">
      <kbd class="item-kbd">←</kbd>
    </div>
  `;
  resumeLi.addEventListener("click", () => {
    dupRovingIndex = resumeIx;
    renderDuplicateOptions();
    void focusChosenAt(lastTabDupRovingIndex);
  });
  listEl.appendChild(resumeLi);

  dupState.duplicates.forEach((d, i) => {
    const rowIx = 2 + i;
    const li = document.createElement("li");
    li.className =
      "item item--tab" +
      (i === 0 ? " item--tab-first" : "") +
      (rowIx === dupRovingIndex ? " selected" : "");
    li.id = `dup-opt-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", rowIx === dupRovingIndex ? "true" : "false");
    li.dataset.kind = "tab";
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="item-index" aria-hidden="true">·</span>
      <div class="item-body">
        <div class="item-title"></div>
        <div class="item-url"></div>
      </div>
    `;
    li.querySelector(".item-title").textContent = d.title || d.url;
    li.querySelector(".item-url").textContent = d.url;
    li.addEventListener("click", () => {
      dupRovingIndex = rowIx;
      lastTabDupRovingIndex = i;
      renderDuplicateOptions();
    });
    li.addEventListener("mouseenter", () => void showTabLinkPreview(d));
    li.addEventListener("mouseleave", () => syncTabThumbFromKeyboard());
    listEl.appendChild(li);
  });

  const stayIx = n + 2;
  const stayLi = document.createElement("li");
  stayLi.className = "item item--action item--stay" + (dupRovingIndex === stayIx ? " selected" : "");
  stayLi.id = "dup-opt-stay";
  stayLi.setAttribute("role", "option");
  stayLi.setAttribute("aria-selected", dupRovingIndex === stayIx ? "true" : "false");
  stayLi.dataset.kind = "stay";
  stayLi.innerHTML = `
    <span class="item-index" aria-hidden="true">·</span>
    <div class="item-body">
      <div class="item-title">Stay here and enjoy the view</div>
    </div>
    <div class="item-keys" aria-hidden="true"></div>
  `;
  stayLi.addEventListener("click", () => {
    dupRovingIndex = stayIx;
    renderDuplicateOptions();
  });
  listEl.appendChild(stayLi);

  syncTabThumbFromKeyboard();
}

async function loadDupState(k) {
  const storageKey = `dup_${k}`;
  const data = await chrome.storage.session.get(storageKey);
  const payload = data[storageKey];
  if (!payload?.targetUrl || !Array.isArray(payload.duplicates)) return null;
  return payload;
}

async function loadConState(c) {
  const storageKey = `consolidate_${c}`;
  const data = await chrome.storage.session.get(storageKey);
  const payload = data[storageKey];
  if (!payload?.pendingUrl || !payload?.hostname || typeof payload.tabCount !== "number") return null;
  return payload;
}

async function focusChosenAt(tabIndex) {
  if (!dupState?.duplicates?.length) return;
  const d = dupState.duplicates[tabIndex];
  if (!d) return;

  const interstitialTabId = dupState.tabId;
  const res = await chrome.runtime.sendMessage({
    type: "tabby-focus-tab",
    tabId: d.id,
    windowId: d.windowId,
  });
  if (!res?.ok) return;

  if (typeof interstitialTabId === "number") {
    await chrome.runtime.sendMessage({ type: "tabby-close-tab", tabId: interstitialTabId });
  }
}

async function openNewAnyway() {
  if (!dupState?.targetUrl || typeof dupState.tabId !== "number") return;
  await chrome.runtime.sendMessage({
    type: "tabby-bypass-and-go",
    tabId: dupState.tabId,
    targetUrl: dupState.targetUrl,
  });
}

async function consolidateAndGo() {
  if (!conState?.pendingUrl || typeof conState.tabId !== "number" || !conState.hostname) return;
  await chrome.runtime.sendMessage({
    type: "tabby-consolidate-host-and-go",
    tabId: conState.tabId,
    hostname: conState.hostname,
    pendingUrl: conState.pendingUrl,
  });
}

async function keepTabsAndGo() {
  if (!conState?.pendingUrl || typeof conState.tabId !== "number") return;
  await chrome.runtime.sendMessage({
    type: "tabby-bypass-and-go",
    tabId: conState.tabId,
    targetUrl: conState.pendingUrl,
  });
}

function setDupDialogCollapsed(collapsed) {
  dupDialogCollapsed = collapsed;
  const card = document.getElementById("dialog-card");
  const hint = document.getElementById("dup-restore-hint");
  if (card) {
    card.classList.toggle("dialog-card--collapsed", collapsed);
    card.setAttribute("aria-hidden", collapsed ? "true" : "false");
  }
  if (hint) hint.hidden = !collapsed;
}

/** Let entrance animation finish, then drop it so collapse/expand can use transitions. */
function clearDialogEntranceAnimation() {
  const card = document.getElementById("dialog-card");
  if (!card) return;
  const run = () => {
    card.style.animation = "none";
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) run();
  else setTimeout(run, 780);
}

function onKeydownDuplicate(e) {
  if (!dupState) return;

  const nTabs = dupState.duplicates?.length ?? 0;
  const total = dupOptionCount();
  if (total <= 0) return;

  if (e.key === "Escape") {
    e.preventDefault();
    setDupDialogCollapsed(!dupDialogCollapsed);
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    dupRovingIndex = Math.min(dupRovingIndex + 1, total - 1);
    if (dupRovingIndex >= 2 && dupRovingIndex <= nTabs + 1) {
      lastTabDupRovingIndex = dupRovingIndex - 2;
    }
    renderDuplicateOptions();
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    dupRovingIndex = Math.max(dupRovingIndex - 1, 0);
    if (dupRovingIndex >= 2 && dupRovingIndex <= nTabs + 1) {
      lastTabDupRovingIndex = dupRovingIndex - 2;
    }
    renderDuplicateOptions();
    return;
  }

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    const tabIx =
      dupRovingIndex >= 2 && dupRovingIndex <= nTabs + 1 ? dupRovingIndex - 2 : lastTabDupRovingIndex;
    void focusChosenAt(tabIx);
    return;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    void openNewAnyway();
    return;
  }

  if (e.key === "Enter") {
    if (dupRovingIndex === 0) {
      e.preventDefault();
      void openNewAnyway();
    } else if (dupRovingIndex === 1) {
      e.preventDefault();
      void focusChosenAt(lastTabDupRovingIndex);
    } else if (dupRovingIndex >= 2 && dupRovingIndex <= nTabs + 1) {
      e.preventDefault();
      void focusChosenAt(dupRovingIndex - 2);
    } else {
      e.preventDefault();
    }
    return;
  }
}

function setDupChromeVisible(visible) {
  const hint = document.getElementById("hint-dup");
  const list = document.getElementById("list");
  if (hint) {
    hint.hidden = visible;
    if (visible) hint.textContent = "";
  }
  if (list) list.hidden = !visible;
}

function setConChromeVisible(visible) {
  const hint = document.getElementById("hint-con-err");
  const actions = document.querySelector("#panel-con .actions");
  if (hint) {
    hint.hidden = visible;
    if (visible) hint.textContent = "";
  }
  if (actions) actions.hidden = !visible;
}

function onKeydownConsolidate(e) {
  if (!conState) return;

  if (e.key === "Escape") {
    e.preventDefault();
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    void keepTabsAndGo();
    return;
  }

  if (e.key === "c" || e.key === "C") {
    e.preventDefault();
    void consolidateAndGo();
    return;
  }
}

async function main() {
  const { k, c } = parseParams();
  const heroSeed = heroSeedFromInvocation(k, c);
  // One round-trip: quotes + hero config are tiny bundled JSON; parallel keeps first paint snappy.
  const [signals, heroConfig] = await Promise.all([loadSignals(), loadHeroConfig()]);
  applyHeroBackdrop(heroConfig, heroSeed);
  if (signals?.length) {
    renderQuote(signals[randomSignalIndex(signals.length)]);
  }

  if (k) {
    dupState = await loadDupState(k);
    if (!dupState) {
      showMode("duplicate");
      setDupChromeVisible(false);
      const hint = document.getElementById("hint-dup");
      if (hint) hint.textContent = "This screen is out of date — you can close it, or try your link again.";
      setFootnote("");
      hideTabThumbPreview();
      dupDialogCollapsed = false;
      setDupDialogCollapsed(false);
      return;
    }
    conState = null;
    showMode("duplicate");
    setDupChromeVisible(true);
    dupRovingIndex = 0;
    lastTabDupRovingIndex = 0;
    dupDialogCollapsed = false;
    setDupDialogCollapsed(false);
    renderDuplicateOptions();
    setFootnote("");
    clearDialogEntranceAnimation();
    window.addEventListener("keydown", onKeydownDuplicate, true);
    return;
  }

  if (c) {
    conState = await loadConState(c);
    if (!conState) {
      showMode("consolidate");
      setConChromeVisible(false);
      const hint = document.getElementById("hint-con-err");
      if (hint) hint.textContent = "This screen expired — close the tab, or use your link again.";
      setFootnote("");
      return;
    }
    dupState = null;
    showMode("consolidate");
    setConChromeVisible(true);
    const body = qs("con-body");
    body.textContent = `You have ${conState.tabCount} tabs open to ${conState.hostname}. Want to close the extras and land here? Or keep everything as-is? We only ask once in a while so it stays helpful, not noisy.`;
    setFootnote(
      "If you tidy up, we’ll close the normal website tabs for this address (not other extensions or browser pages), then open your link in this tab.",
    );
    qs("btn-merge").addEventListener("click", () => void consolidateAndGo());
    qs("btn-keep").addEventListener("click", () => void keepTabsAndGo());
    clearDialogEntranceAnimation();
    window.addEventListener("keydown", onKeydownConsolidate, true);
    return;
  }

  showMode("duplicate");
  setDupChromeVisible(false);
  const hint = document.getElementById("hint-dup");
  if (hint) hint.textContent = "Something’s missing — you can close this tab.";
  setFootnote("");
  hideTabThumbPreview();
  dupDialogCollapsed = false;
  setDupDialogCollapsed(false);
}

void main().catch((err) => {
  console.error("[Tabby] interstitial failed to initialize", err);
});
