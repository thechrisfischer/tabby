function qs(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function parseKey() {
  const u = new URL(location.href);
  return u.searchParams.get("k");
}

let state = null;
let selectedIndex = 0;

function render() {
  const listEl = qs("list");
  const hostEl = qs("host");
  if (!state) {
    hostEl.textContent = "—";
    listEl.innerHTML = "";
    return;
  }

  const host = new URL(state.targetUrl).hostname;
  hostEl.textContent = host;

  listEl.replaceChildren();
  state.duplicates.forEach((d, i) => {
    const li = document.createElement("li");
    li.className = "item" + (i === selectedIndex ? " selected" : "");
    li.tabIndex = 0;
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="item-index">${i < 9 ? i + 1 : "·"}</span>
      <div class="item-body">
        <div class="item-title"></div>
        <div class="item-url"></div>
      </div>
    `;
    li.querySelector(".item-title").textContent = d.title || d.url;
    li.querySelector(".item-url").textContent = d.url;
    li.addEventListener("click", () => {
      selectedIndex = i;
      render();
    });
    listEl.appendChild(li);
  });
}

async function loadState(k) {
  const storageKey = `dup_${k}`;
  const data = await chrome.storage.session.get(storageKey);
  const payload = data[storageKey];
  if (!payload?.targetUrl || !Array.isArray(payload.duplicates)) return null;
  return payload;
}

async function focusChosen() {
  if (!state?.duplicates?.length) return;
  const d = state.duplicates[selectedIndex];
  if (!d) return;

  const interstitialTabId = state.tabId;
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
  if (!state?.targetUrl || typeof state.tabId !== "number") return;
  await chrome.runtime.sendMessage({
    type: "tabby-bypass-and-go",
    tabId: state.tabId,
    targetUrl: state.targetUrl,
  });
}

function onKeydown(e) {
  if (!state) return;

  if (e.key === "Escape") {
    e.preventDefault();
    return;
  }

  if (e.key === "n" || e.key === "N") {
    e.preventDefault();
    void openNewAnyway();
    return;
  }

  if (e.key === "y" || e.key === "Y" || e.key === "Enter") {
    e.preventDefault();
    void focusChosen();
    return;
  }

  if (/^[1-9]$/.test(e.key)) {
    const n = parseInt(e.key, 10) - 1;
    if (n >= 0 && n < state.duplicates.length) {
      e.preventDefault();
      selectedIndex = n;
      render();
      void focusChosen();
    }
  }
}

async function main() {
  const k = parseKey();
  const hint = document.getElementById("hint");
  if (!k) {
    if (hint) hint.textContent = "Missing session key. You can close this tab.";
    return;
  }

  state = await loadState(k);
  if (!state) {
    if (hint) hint.textContent = "This prompt expired or was already used. Close the tab.";
    return;
  }

  selectedIndex = 0;
  render();

  qs("btn-switch").addEventListener("click", () => void focusChosen());
  qs("btn-new").addEventListener("click", () => void openNewAnyway());
  window.addEventListener("keydown", onKeydown, true);
}

void main();
