import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateConsolidationPitch, REARM_GROWTH } from "../src/cooldown.mjs";

const NOW = 1_700_000_000_000;

test("first pitch (no prior record) always allowed", () => {
  const allowed = evaluateConsolidationPitch({
    prior: null,
    currentCount: 3,
    cooldownMs: 300_000,
    now: NOW,
  });
  assert.equal(allowed, true);
});

test("within cooldown window, no growth → silent", () => {
  const allowed = evaluateConsolidationPitch({
    prior: { at: NOW - 60_000, count: 4 },
    currentCount: 4,
    cooldownMs: 300_000,
    now: NOW,
  });
  assert.equal(allowed, false);
});

test("within cooldown window, growth by REARM_GROWTH → fires", () => {
  const allowed = evaluateConsolidationPitch({
    prior: { at: NOW - 60_000, count: 4 },
    currentCount: 4 + REARM_GROWTH,
    cooldownMs: 300_000,
    now: NOW,
  });
  assert.equal(allowed, true);
});

test("past cooldown window → fires regardless of growth", () => {
  const allowed = evaluateConsolidationPitch({
    prior: { at: NOW - 600_000, count: 10 },
    currentCount: 3,
    cooldownMs: 300_000,
    now: NOW,
  });
  assert.equal(allowed, true);
});

test("Off (cooldownMs=0): cooldown check disabled, growth still works", () => {
  // Same situation as last pitch: silent (no growth, no time check)
  assert.equal(
    evaluateConsolidationPitch({
      prior: { at: NOW - 1, count: 5 },
      currentCount: 5,
      cooldownMs: 0,
      now: NOW,
    }),
    false,
  );
  // Growth past +REARM_GROWTH: fires
  assert.equal(
    evaluateConsolidationPitch({
      prior: { at: NOW - 1, count: 5 },
      currentCount: 5 + REARM_GROWTH,
      cooldownMs: 0,
      now: NOW,
    }),
    true,
  );
});

test("legacy prior shape (bare number) → treated as { at, count: 0 }", () => {
  // Bare number prior: count defaults to 0, so any currentCount >= REARM_GROWTH fires via growth
  assert.equal(
    evaluateConsolidationPitch({
      prior: NOW - 60_000,
      currentCount: REARM_GROWTH,
      cooldownMs: 300_000,
      now: NOW,
    }),
    true,
  );
  // currentCount below REARM_GROWTH and within cooldown → silent
  assert.equal(
    evaluateConsolidationPitch({
      prior: NOW - 60_000,
      currentCount: REARM_GROWTH - 1,
      cooldownMs: 300_000,
      now: NOW,
    }),
    false,
  );
});
