const statusEl = document.getElementById("status");
const btn = document.getElementById("consolidate");
const undoBtn = document.getElementById("undo");

const UNDO_WINDOW_MS = 10000;

let undoState = null; // { sessionIds, expiresAt, intervalId, closedCount, hostCount }

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.dataset.kind = kind ?? "";
}

async function getPreferredTabId() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id;
}

function clearUndo() {
  if (undoState?.intervalId) clearInterval(undoState.intervalId);
  undoState = null;
  if (undoBtn) {
    undoBtn.hidden = true;
    undoBtn.disabled = false;
    undoBtn.textContent = "Undo";
  }
}

function renderUndoTick() {
  if (!undoState || !undoBtn) return;
  const msLeft = undoState.expiresAt - Date.now();
  if (msLeft <= 0) {
    clearUndo();
    setStatus("Back to execution.", "ok");
    window.setTimeout(() => window.close(), 600);
    return;
  }
  const secsLeft = Math.ceil(msLeft / 1000);
  undoBtn.textContent = `Undo (${secsLeft}s)`;
}

function startUndoCountdown(sessionIds, closedCount, hostCount) {
  if (!undoBtn) return;
  if (!sessionIds || sessionIds.length === 0) return;
  undoState = {
    sessionIds,
    closedCount,
    hostCount,
    expiresAt: Date.now() + UNDO_WINDOW_MS,
    intervalId: null,
  };
  undoBtn.hidden = false;
  undoBtn.disabled = false;
  renderUndoTick();
  undoState.intervalId = window.setInterval(renderUndoTick, 250);
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
    `${res.closedCount} tab(s) across ${res.hostCount} hostname(s) can close — we keep your active tab plus the most recent per site.`,
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
    window.setTimeout(() => window.close(), 450);
    return;
  }

  setStatus(
    `Closed ${res.closedCount} tab(s) across ${res.hostCount} hostname(s).`,
    "ok",
  );
  startUndoCountdown(res.undoSessionIds || [], res.closedCount, res.hostCount);

  // If sessions API returned nothing, behave like the old flow.
  if (!res.undoSessionIds || res.undoSessionIds.length === 0) {
    window.setTimeout(() => window.close(), 450);
  }
}

async function runUndo() {
  if (!undoBtn || !undoState) return;
  const { sessionIds, closedCount, hostCount } = undoState;
  undoBtn.disabled = true;
  setStatus("Restoring…", "muted");
  const res = await chrome.runtime.sendMessage({
    type: "tabby-undo-consolidate",
    sessionIds,
  });
  clearUndo();
  if (!res?.ok) {
    setStatus(res?.error ? `Undo failed: ${res.error}` : "Undo failed.", "err");
    return;
  }
  const r = res.restored ?? 0;
  if (r === closedCount) {
    setStatus(`Reopened ${r} tab(s) across ${hostCount} hostname(s).`, "ok");
  } else {
    setStatus(`Reopened ${r} of ${closedCount} tab(s) — some had aged out.`, "ok");
  }
  window.setTimeout(() => window.close(), 800);
}

btn?.addEventListener("click", () => void runConsolidate());
undoBtn?.addEventListener("click", () => void runUndo());
window.addEventListener("beforeunload", clearUndo);
void refreshPreview();
