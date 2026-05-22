import { test } from "node:test";
import assert from "node:assert/strict";
import { identityKey } from "../src/identity.mjs";

// Positive cases — recognized Google apps with /u/N/

test("gmail /u/0/ URL returns canonical key", () => {
  assert.equal(
    identityKey("https://mail.google.com/mail/u/0/#inbox"),
    "mail.google.com|/u/0/",
  );
});

test("calendar /u/1/ URL returns canonical key", () => {
  assert.equal(
    identityKey("https://calendar.google.com/calendar/u/1/r/week/2026/5/25"),
    "calendar.google.com|/u/1/",
  );
});

test("drive /u/0/ URL returns canonical key", () => {
  assert.equal(
    identityKey("https://drive.google.com/drive/u/0/my-drive"),
    "drive.google.com|/u/0/",
  );
});

test("docs /u/0/ URL returns canonical key", () => {
  assert.equal(
    identityKey("https://docs.google.com/document/u/0/d/abc123/edit"),
    "docs.google.com|/u/0/",
  );
});

test("uppercase host is normalized", () => {
  assert.equal(
    identityKey("https://MAIL.GOOGLE.COM/mail/u/0/#inbox"),
    "mail.google.com|/u/0/",
  );
});

test("two-digit account id is preserved", () => {
  assert.equal(
    identityKey("https://mail.google.com/mail/u/12/#inbox"),
    "mail.google.com|/u/12/",
  );
});

// Negative cases — fall through to existing layers

test("google.com without /u/N/ returns null", () => {
  assert.equal(identityKey("https://mail.google.com/"), null);
  assert.equal(identityKey("https://www.google.com/search?q=x"), null);
});

test("non-google host returns null even with /u/N/", () => {
  assert.equal(identityKey("https://example.com/app/u/0/foo"), null);
});

test("non-digit account segment returns null", () => {
  assert.equal(identityKey("https://mail.google.com/mail/u/abc/"), null);
});

test("missing trailing slash on /u/N/ returns null", () => {
  // The regex requires a trailing slash after the digits so we only
  // match real account segments, not stray /u/0... patterns.
  assert.equal(identityKey("https://mail.google.com/mail/u/0"), null);
});

test("malformed URL returns null", () => {
  assert.equal(identityKey("not a url"), null);
  assert.equal(identityKey(""), null);
  assert.equal(identityKey(undefined), null);
});

test("host suffix match is strict (no 'fakegoogle.com')", () => {
  // .endsWith(".google.com") requires the dot — "fakegoogle.com" does
  // NOT end with ".google.com" (no preceding dot before "google.com").
  assert.equal(identityKey("https://fakegoogle.com/x/u/0/"), null);
});
