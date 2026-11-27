// ZIP code -> districts lookup, built from Census 2020 relationship files.
// ZIP areas (ZCTAs) are matched to census tracts, and tracts to districts, weighted by
// land area. Written as small files by the first 3 digits: data/zip/<123>.json =
// { "12345": { "c": [["NH", 2, 0.97], ["NH", 1, 0.03]], "u": "15", "l": "Merrimack 18" } }
// c = U.S. House districts (state, district, share of the ZIP's land), largest first.
// u / l = the state senate / state house district covering most of the ZIP.
// Districts only change after redistricting, so this runs only when asked or missing.
import fs from "node:fs";
import path from "node:path";
import { DATA, get, log, writeJSON } from "./util.mjs";

const BASE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020";
const FIPS = { "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY","60":"AS","66":"GU","69":"MP","72":"PR","78":"VI" };

function table(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split("|");
  const find = re => head.findIndex(h => re.test(h));
  const col = re => { const i = find(re); if (i < 0) throw new Error(`no column ${re} in ${head.join(",")}`); return i; };
  return { head, rows: lines.slice(1).map(l => l.split("|")), col, find };
}

const text = url => get(url, { type: "text", okMissing: true }).catch(e => { log(`zips: ${url} failed: ${e.message}`); return null; });

async function cdTractFile() {
  // Prefer the current Congress's districts; fall back to the previous set.
  for (const c of [120, 119, 118]) {
    const t = await text(`${BASE}/cd-sld/tab20_cd${c}20_tract20_natl.txt`);
    if (t && t.includes("|")) { log(`zips: using ${c}th Congress districts`); return t; }
  }
  throw new Error("no district-to-tract file found");
}

// State legislative district files: find the newest tract file for each chamber in the folder listing.
async function sldTractFile(kind) {
  const listing = (await text(`${BASE}/cd-sld/`)) || "";
  const names = [...new Set([...listing.matchAll(/href="([^"]+\.txt)"/g)].map(m => m[1]))];
  const ours = names.filter(n => new RegExp(`sld${kind}`, "i").test(n) && /tract/i.test(n) && /natl/i.test(n)).sort().reverse();
  log(`zips: sld${kind} candidates: ${ours.join(", ") || "none"} (folder has ${names.length} files)`);
  if (!ours.length) log(`zips: folder files: ${names.join(", ").slice(0, 1500)}`);
  for (const n of ours) { const t = await text(`${BASE}/cd-sld/${n}`); if (t && t.includes("|")) return { name: n, t }; }
  return null;
}

// Turn a Census district label into the short name people and Open States use ("Merrimack 18", "15").
export function sldName(label, code) {
  let s = (label || "").replace(/\b(State|House|Senate|Assembly|Legislative|Representative|Delegate|District|Subdistrict)\b/gi, "").replace(/\(\d{4}\)/g, "").replace(/\s+/g, " ").trim();
  if (!s) s = (code || "").replace(/^0+/, "");
  if (/^0*\d+$/.test(s)) s = String(parseInt(s, 10));
  return s;
}

function byTract(t, geoRe, nameRe) {
  const g = t.col(geoRe), tr = t.col(/^GEOID_TRACT/), a = t.col(/^AREALAND_PART$/), nm = nameRe ? t.find(nameRe) : -1;
  const out = new Map(), names = new Map();
  for (const r of t.rows) {
    const area = +r[a]; if (!area || !r[g]) continue;
    const list = out.get(r[tr]) || []; list.push([r[g], area]); out.set(r[tr], list);
    if (nm >= 0 && !names.has(r[g])) names.set(r[g], r[nm]);
  }
  return { tracts: out, names };
}

export async function buildZips({ force = false } = {}) {
  const dir = path.join(DATA, "zip");
  if (!force && fs.existsSync(dir) && fs.readdirSync(dir).length > 100) {
    const sample = Object.values(JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), "utf8")))[0];
    if (sample && !Array.isArray(sample)) { log("zips: already built"); return; }
  }
  const layers = { c: byTract(table(await cdTractFile()), /^GEOID_CD\d+/) };
  for (const k of ["u", "l"]) {
    const f = await sldTractFile(k);
    if (!f) { log(`zips: no state ${k === "u" ? "senate" : "house"} file, skipping`); continue; }
    const t = table(f.t);
    log(`zips: ${f.name} columns: ${t.head.join(",")}`);
    const nh = t.rows.filter(r => r.some(x => /^33\d{3}/.test(x) && x.length <= 6)).slice(0, 3);
    log(`zips: NH sample: ${nh.map(r => r.join("|")).join(" // ")}`);
    layers[k] = byTract(t, new RegExp(`^GEOID_SLD${k.toUpperCase()}`, "i"), new RegExp(`^NAMELSAD_SLD${k.toUpperCase()}`, "i"));
  }
  // zcta -> tract pieces -> weighted districts per layer
  const zt = table(await get(`${BASE}/zcta520/tab20_zcta520_tract20_natl.txt`, { type: "text" }));
  const zG = zt.col(/^GEOID_ZCTA5/), ztG = zt.col(/^GEOID_TRACT/), zaP = zt.col(/^AREALAND_PART$/);
  const zips = new Map();
  for (const r of zt.rows) {
    const z = r[zG], a = +r[zaP]; if (!z || !a) continue;
    const entry = zips.get(z) || {}; let hit = false;
    for (const [k, L] of Object.entries(layers)) {
      const parts = L.tracts.get(r[ztG]); if (!parts) continue; hit = true;
      const tot = parts.reduce((s, p) => s + p[1], 0), m = entry[k] || (entry[k] = new Map());
      for (const [g, pa] of parts) m.set(g, (m.get(g) || 0) + a * pa / tot);
    }
    if (hit) zips.set(z, entry);
  }
  const shards = {}; let withState = 0;
  for (const [z, e] of zips) {
    if (!e.c) continue;
    const tot = [...e.c.values()].reduce((s, v) => s + v, 0);
    const c = [...e.c].map(([g, v]) => [FIPS[g.slice(0, 2)], parseInt(g.slice(2), 10), Math.round(v / tot * 100) / 100])
      .filter(x => x[0] && x[2] >= 0.02).sort((a, b) => b[2] - a[2]);
    if (!c.length) continue;
    const out = { c }, stF = Object.keys(FIPS).find(f => FIPS[f] === c[0][0]);
    for (const k of ["u", "l"]) {
      if (!e[k]) continue;
      const top = [...e[k]].filter(([g]) => g.startsWith(stF)).sort((a, b) => b[1] - a[1])[0];
      if (top && !/Z+$/i.test(top[0])) out[k] = sldName(layers[k].names.get(top[0]), top[0].slice(2));
    }
    if (out.u || out.l) withState++;
    (shards[z.slice(0, 3)] = shards[z.slice(0, 3)] || {})[z] = out;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(shards)) writeJSON(`zip/${k}.json`, v);
  const s = shards["030"] || {};
  log(`zips: ${zips.size} ZIP areas in ${Object.keys(shards).length} files, ${withState} with state districts. e.g. 03031=${JSON.stringify(s["03031"])} 03301=${JSON.stringify(s["03301"])}`);
}
