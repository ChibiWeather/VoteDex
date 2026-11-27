// Shared helpers for the daily data refresh.
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const DATA = path.join(ROOT, "site", "data");

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function readJSON(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8")); } catch { return fallback; }
}
export function writeJSON(rel, value) {
  const file = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value);
  // Only touch the file if it changed, so daily commits stay small.
  try { if (fs.readFileSync(file, "utf8") === text) return false; } catch {}
  fs.writeFileSync(file, text);
  return true;
}

const UA = "Mozilla/5.0 (compatible; ProgressOfCongress/1.0; +https://github.com)";

// A per-host request budget so one run never blows through an API's hourly limit.
const budgets = new Map();
export function setBudget(host, max, gapMs = 0) { budgets.set(host, { left: max, gapMs, last: 0 }); }
export function budgetLeft(host) { return budgets.get(host)?.left ?? Infinity; }
export class OutOfBudget extends Error {}

export async function get(url, { type = "json", headers = {}, tries = 4, okMissing = false } = {}) {
  const host = new URL(url).host;
  const b = budgets.get(host);
  for (let i = 1; i <= tries; i++) {
    if (b) {
      if (b.left <= 0) throw new OutOfBudget(host);
      const wait = b.last + b.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      b.left--; b.last = Date.now();
    }
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: type === "json" ? "application/json" : "*/*", ...headers } });
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1000 * 2 ** i); continue;
    }
    if (res.ok) return type === "json" ? res.json() : res.text();
    if (okMissing && res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      if (i === tries) throw new Error(`${res.status} ${redact(url)}`);
      const ra = +res.headers.get("retry-after") || 0;
      await sleep(Math.max(ra * 1000, 2000 * 2 ** i)); continue;
    }
    throw new Error(`${res.status} ${redact(url)}`);
  }
}
// Never print the API key in logs.
export const redact = u => String(u).replace(/(api_key=)[^&]+/i, "$1***");

export const party = p => /^Dem/i.test(p) ? "D" : /^Rep/i.test(p) ? "R" : "I";
