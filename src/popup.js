const statusEl = document.getElementById("status");
const btn = document.getElementById("consolidate");

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.kind = kind ?? "";
}

async function getPreferredTabId() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id;
}

async function refreshPreview() {
  setStatus("Scanning…", "muted");
  const preferTabId = await getPreferredTabId();
  const res = await chrome.runtime.sendMessage({
    type: "tabby-consolidate",
    dryRun: true,
    preferTabId,
  });

  if (!res?.ok) {
    setStatus(res?.error ? `Could not scan: ${res.error}` : "Could not scan tabs.", "err");
    return;
  }

  if (res.closedCount === 0) {
    setStatus("No duplicate hostnames — nothing to consolidate.", "ok");
    if (btn) btn.disabled = true;
    return;
  }

  if (btn) btn.disabled = false;
  setStatus(
    `${res.closedCount} tab(s) across ${res.hostCount} hostname(s) can be closed. Keeps your active tab when it’s part of a group.`,
    "muted",
  );
}

async function runConsolidate() {
  if (!btn) return;
  btn.disabled = true;
  setStatus("Closing duplicates…", "muted");
  const preferTabId = await getPreferredTabId();
  const res = await chrome.runtime.sendMessage({
    type: "tabby-consolidate",
    dryRun: false,
    preferTabId,
  });

  if (!res?.ok) {
    setStatus(res?.error ? `Failed: ${res.error}` : "Something went wrong.", "err");
    btn.disabled = false;
    return;
  }

  if (res.closedCount === 0) {
    setStatus("No duplicates to close.", "ok");
  } else {
    setStatus(`Closed ${res.closedCount} duplicate tab(s) (${res.hostCount} hostname(s)).`, "ok");
  }

  window.setTimeout(() => window.close(), 450);
}

btn?.addEventListener("click", () => void runConsolidate());
void refreshPreview();
