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
  setStatus("Scanning workspace…", "muted");
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
    setStatus("No stacked hostnames — you are already running lean.", "ok");
    if (btn) btn.disabled = true;
    return;
  }

  if (btn) btn.disabled = false;
  setStatus(
    `${res.closedCount} tab(s) across ${res.hostCount} hostname(s) can close — we keep your active tab when it is part of a cluster.`,
    "muted",
  );
}

async function runConsolidate() {
  if (!btn) return;
  btn.disabled = true;
  setStatus("Trimming stack…", "muted");
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
    setStatus("Nothing left to trim.", "ok");
  } else {
    setStatus(`Closed ${res.closedCount} tab(s) across ${res.hostCount} hostname(s). Back to execution.`, "ok");
  }

  window.setTimeout(() => window.close(), 450);
}

btn?.addEventListener("click", () => void runConsolidate());
void refreshPreview();
