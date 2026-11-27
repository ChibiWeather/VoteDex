// ZIP code -> congressional district lookup, built from Census 2020 relationship files.
// ZIP areas (ZCTAs) are matched to census tracts, and tracts to districts, weighted by
// land area. Written as small files by the first 3 digits: data/zip/<123>.json =
// { "12345": [["NH", 2, 0.97], ["NH", 1, 0.03]] }  (state, district, share of the ZIP's land)
// Districts only change after redistricting, so this runs only when asked or missing.
import fs from "node:fs";
import path from "node:path";
import { DATA, get, log, writeJSON } from "./util.mjs";

const BASE = "https://www2.census.gov/geo/docs/maps-data/data/rel2020";
const FIPS = { "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY","60":"AS","66":"GU","69":"MP","72":"PR","78":"VI" };

function table(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split("|");
  const col = re => { const i = head.findIndex(h => re.test(h)); if (i < 0) throw new Error(`no column ${re} in ${head.join(",")}`); return i; };
  return { rows: lines.slice(1).map(l => l.split("|")), col };
}

async function cdTractFile() {
  // Prefer the current Congress's districts; fall back to the previous set.
  for (const c of [120, 119, 118]) {
    const url = `${BASE}/cd-sld/tab20_cd${c}20_tract20_natl.txt`;
    const t = await get(url, { type: "text", okMissing: true }).catch(() => null);
    if (t && t.includes("|")) { log(`zips: using ${c}th Congress districts`); return t; }
  }
  throw new Error("no district-to-tract file found");
}

export async function buildZips({ force = false } = {}) {
  const dir = path.join(DATA, "zip");
  if (!force && fs.existsSync(dir) && fs.readdirSync(dir).length > 100) { log("zips: already built"); return; }
  // tract -> [[cd geoid, land area], ...]
  const cdT = table(await cdTractFile());
  const cG = cdT.col(/^GEOID_CD\d+/), tG = cdT.col(/^GEOID_TRACT/), aP = cdT.col(/^AREALAND_PART$/);
  const tract = new Map();
  for (const r of cdT.rows) {
    const a = +r[aP]; if (!a) continue;
    const list = tract.get(r[tG]) || []; list.push([r[cG], a]); tract.set(r[tG], list);
  }
  // zcta -> tract pieces
  const zt = table(await get(`${BASE}/zcta520/tab20_zcta520_tract20_natl.txt`, { type: "text" }));
  const zG = zt.col(/^GEOID_ZCTA5/), ztG = zt.col(/^GEOID_TRACT/), zaP = zt.col(/^AREALAND_PART$/);
  const zips = new Map();
  for (const r of zt.rows) {
    const z = r[zG], a = +r[zaP]; if (!z || !a) continue;
    const parts = tract.get(r[ztG]); if (!parts) continue;
    const tot = parts.reduce((s, p) => s + p[1], 0);
    const m = zips.get(z) || new Map();
    for (const [cd, pa] of parts) m.set(cd, (m.get(cd) || 0) + a * pa / tot);
    zips.set(z, m);
  }
  const shards = {};
  for (const [z, m] of zips) {
    const tot = [...m.values()].reduce((s, v) => s + v, 0);
    const list = [...m].map(([g, v]) => [FIPS[g.slice(0, 2)], parseInt(g.slice(2), 10), Math.round(v / tot * 100) / 100])
      .filter(x => x[0] && x[2] >= 0.02).sort((a, b) => b[2] - a[2]);
    if (!list.length) continue;
    (shards[z.slice(0, 3)] = shards[z.slice(0, 3)] || {})[z] = list;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(shards)) writeJSON(`zip/${k}.json`, v);
  log(`zips: ${zips.size} ZIP areas in ${Object.keys(shards).length} files`);
}
