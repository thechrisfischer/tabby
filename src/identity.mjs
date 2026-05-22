/**
 * Returns a canonical "strict app instance" key for the URL, or null
 * if the URL doesn't match any strict rule.
 *
 * Today: matches *.google.com URLs with a /u/<digit>/ segment.
 * Future: this is the seam for additional rules (Notion workspaces,
 * Slack workspaces, etc.). Internals can grow into a rules table
 * without changing callers.
 */
export function identityKey(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".google.com")) return null;
  const m = u.pathname.match(/^\/[^/]+\/u\/(\d+)\//);
  if (!m) return null;
  return `${host}|/u/${m[1]}/`;
}
