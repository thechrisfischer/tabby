/**
 * Pure consolidation-pitch decision logic. No chrome.* dependencies.
 *
 * Imported by:
 *   - src/background.js  (the MV3 service worker)
 *   - tests/cooldown.test.mjs  (Node built-in test runner)
 *
 * Living here as a separate ES module keeps the logic testable in Node
 * (which would otherwise treat the SW file as CommonJS without a
 * package.json "type": "module" declaration).
 */

/**
 * Default cooldown when no user setting exists yet (5 min).
 * Tuned for short bursts of tab sprawl rather than long quiet sessions.
 * Duplicated as a plain `const` in src/popup.js — popup runs as a classic script
 * (no `type="module"`) so it can't import from here. Keep the two values identical.
 */
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Re-arm growth threshold: re-pitch a host once its tab count grows by this
 * much since the last pitch, even mid-cooldown. Tunable here, not in user
 * settings — keeps the configuration surface small.
 */
export const REARM_GROWTH = 2;

/**
 * `prior` accepts both the new `{ at, count }` shape and the legacy bare
 * `number` (timestamp only) so v1.5 session data doesn't break v1.6 on first
 * load after upgrade.
 *
 * Returns true if Tabby should pitch the consolidate interstitial now.
 *
 * Rules:
 *  - No prior pitch → always allowed.
 *  - cooldownMs === 0 → "Off" mode. Time check disabled; only growth can re-arm.
 *  - Otherwise: fire if cooldown elapsed OR tab count grew by REARM_GROWTH+.
 */
export function evaluateConsolidationPitch({ prior, currentCount, cooldownMs, now }) {
  if (prior == null) return true;
  const normalized =
    typeof prior === "number" ? { at: prior, count: 0 } : prior;

  const cooldownElapsed =
    cooldownMs > 0 && now - normalized.at > cooldownMs;
  const grewSinceLastPitch =
    currentCount >= normalized.count + REARM_GROWTH;

  return cooldownElapsed || grewSinceLastPitch;
}
