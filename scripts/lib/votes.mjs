// Roll-call votes straight from the House Clerk and the Senate, no key needed.
// Each vote is cached as data/votes/rc/<id>.json, so a daily run only fetches new ones.
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { DATA, get, log, readJSON, writeJSON, setBudget } from "./util.mjs";

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#t", parseTagValue: false, trimValues: true });
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
const txt = v => v == null ? "" : typeof v === "object" ? String(v["#t"] ?? "") : String(v);

export const congressOf = year => Math.floor((year - 1789) / 2) + 1;
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const iso = d => d.toISOString().slice(0, 10);

// "H R 8800" / "H.R. 8800" / "S.J.Res. 12" -> "hr8800" / "sjres12"
export function billId(type, num) {
  const t = String(type || "").toLowerCase().replace(/[^a-z]/g, "");
  const n = String(num || "").replace(/\D/g, "");
  if (!n || !/^(hr|s|hres|sres|hjres|sjres|hconres|sconres)$/.test(t)) return null;
  return t + n;
}
const norm = v => /^(yea|aye|yes|guilty)$/i.test(v) ? "Y" : /^(nay|no|not guilty)$/i.test(v) ? "N" : /^present/i.test(v) ? "P" : "X";

const rcPath = id => `votes/rc/${id}.json`;
const have = id => fs.existsSync(path.join(DATA, rcPath(id)));

function packPositions(list) { // [[memberId, Y|N|P|X], ...] -> {Y:[...],N:[...],...}
  const out = { Y: [], N: [], P: [], X: [] };
  for (const [id, v] of list) if (id) out[v].push(id);
  return out;
}

// ---------- House ----------
async function houseVote(year, n) {
  const url = `https://clerk.house.gov/evs/${year}/roll${String(n).padStart(3, "0")}.xml`;
  const body = await get(url, { type: "text", okMissing: true });
  if (!body || !body.includes("<rollcall-vote")) return null;
  const doc = xml.parse(body)["rollcall-vote"];
  const md = doc["vote-metadata"];
  const [dd, mon, yy] = txt(md["action-date"]).split("-");
  const date = iso(new Date(Date.UTC(+yy, MON[mon], +dd)));
  const legis = txt(md["legis-num"]);
  const m = legis.match(/^([A-Z .]+?)\s*(\d+)$/);
  const tot = arr(md["vote-totals"]?.["totals-by-vote"])[0] || {};
  const pos = arr(doc["vote-data"]?.["recorded-vote"]).map(r => [r.legislator?.["@name-id"], norm(txt(r.vote))]);
  return {
    id: `h${year}-${n}`, ch: "r", date, n,
    q: txt(md["vote-question"]),
    desc: txt(md["vote-desc"]),
    result: txt(md["vote-result"]),
    bill: m ? billId(m[1], m[2]) : null,
    billLabel: legis,
    t: { Y: +txt(tot["yea-total"]) || 0, N: +txt(tot["nay-total"]) || 0, P: +txt(tot["present-total"]) || 0, X: +txt(tot["not-voting-total"]) || 0 },
    pos: packPositions(pos),
  };
}

async function refreshHouse(year) {
  // Walk forward from the newest cached roll call until two in a row are missing.
  let n = 1;
  while (have(`h${year}-${n}`)) n++;
  let misses = 0, added = 0;
  for (; misses < 2; n++) {
    if (have(`h${year}-${n}`)) { misses = 0; continue; }
    const v = await houseVote(year, n);
    if (!v) { misses++; continue; }
    misses = 0; writeJSON(rcPath(v.id), v); added++;
  }
  log(`house ${year}: +${added}`);
}

// ---------- Senate ----------
const SEN_HEADERS = { "Accept": "application/xml,text/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };

async function senateVote(cong, sess, year, n, lisToBio) {
  const num = String(n).padStart(5, "0");
  const url = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${cong}${sess}/vote_${cong}_${sess}_${num}.xml`;
  const body = await get(url, { type: "text", okMissing: true, headers: SEN_HEADERS });
  if (!body || !body.includes("<roll_call_vote")) return null;
  const doc = xml.parse(body).roll_call_vote;
  const d = new Date(txt(doc.vote_date).replace(/,\s+\d{1,2}:\d{2}.*$/, "") + " 12:00 UTC");
  const dc = doc.document || {};
  const pos = arr(doc.members?.member).map(mm => [lisToBio[txt(mm.lis_member_id)] || null, norm(txt(mm.vote_cast))]);
  const c = doc.count || {};
  return {
    id: `s${year}-${n}`, ch: "s", date: isNaN(d) ? `${year}-01-01` : iso(d), n,
    q: txt(doc.question) || txt(doc.vote_question_text),
    desc: txt(doc.vote_title) || txt(doc.vote_question_text),
    result: txt(doc.vote_result) || txt(doc.vote_result_text),
    bill: billId(txt(dc.document_type), txt(dc.document_number)),
    billLabel: txt(dc.document_name),
    t: { Y: +txt(c.yeas) || 0, N: +txt(c.nays) || 0, P: +txt(c.present) || 0, X: +txt(c.absent) || 0 },
    pos: packPositions(pos),
  };
}

async function refreshSenate(year, lisToBio) {
  const cong = congressOf(year), sess = year % 2 ? 1 : 2;
  const menuUrl = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${cong}_${sess}.xml`;
  const menu = await get(menuUrl, { type: "text", okMissing: true, headers: SEN_HEADERS });
  let max = 0;
  if (menu && menu.includes("<vote_summary")) {
    for (const v of arr(xml.parse(menu).vote_summary?.votes?.vote)) max = Math.max(max, +txt(v.vote_number) || 0);
  }
  let added = 0;
  for (let n = 1; n <= max; n++) {
    if (have(`s${year}-${n}`)) continue;
    const v = await senateVote(cong, sess, year, n, lisToBio);
    if (v) { writeJSON(rcPath(v.id), v); added++; }
  }
  log(`senate ${year}: ${max} on list, +${added}`);
}

// ---------- derived files the site reads ----------
const BIG = /passage|pass(ed)?\b|concur|agreeing to the (senate|house) amendment|conference report|override/i;

export function buildVoteFiles(members) {
  const dir = path.join(DATA, "votes", "rc");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")) : [];
  const now = new Date().getUTCFullYear();
  const cong = congressOf(now);
  const yearsOfCong = [1789 + (cong - 1) * 2, 1790 + (cong - 1) * 2];
  const all = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter(v => yearsOfCong.includes(+v.date.slice(0, 4)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.n - a.n);

  const byId = Object.fromEntries(members.map(m => [m.id, m]));
  const perMember = {}, perBill = {}, index = [];
  for (const v of all) {
    // party majority position, for the "votes with party" stat
    const tally = {};
    for (const k of ["Y", "N"]) for (const id of v.pos[k]) {
      const m = byId[id]; if (!m) continue;
      const p = m.vp || m.p; tally[p] = tally[p] || { Y: 0, N: 0 }; tally[p][k]++;
    }
    const pm = {};
    for (const [p, t] of Object.entries(tally)) if (t.Y !== t.N) pm[p] = t.Y > t.N ? "Y" : "N";
    index.push({ id: v.id, ch: v.ch, date: v.date, q: v.q, desc: v.desc, result: v.result, bill: v.bill, bl: v.billLabel, t: v.t, pm, big: BIG.test(v.q) ? 1 : 0 });
    for (const k of ["Y", "N", "P", "X"]) for (const id of v.pos[k]) (perMember[id] = perMember[id] || {})[v.id] = k;
    if (v.bill) (perBill[v.bill] = perBill[v.bill] || []).push({ id: v.id, ch: v.ch, date: v.date, q: v.q, result: v.result, t: v.t, big: BIG.test(v.q) ? 1 : 0, pos: v.pos });
  }
  writeJSON("votes/index.json", index);
  for (const [id, map] of Object.entries(perMember)) writeJSON(`votes/m/${id}.json`, map);
  for (const [id, list] of Object.entries(perBill)) writeJSON(`votes/b/${id}.json`, list);
  log(`votes: ${index.length} roll calls in the ${cong}th Congress, ${Object.keys(perBill).length} bills`);
  return { index, billsWithVotes: Object.keys(perBill) };
}

export async function refreshVotes(members) {
  setBudget("clerk.house.gov", 3000, 250);
  setBudget("www.senate.gov", 3000, 400);
  const lisToBio = Object.fromEntries(members.filter(m => m.lis).map(m => [m.lis, m.id]));
  // Senators who left keep old LIS ids; keep any mapping we learned before.
  Object.assign(lisToBio, Object.fromEntries(Object.entries(readJSON("votes/lis.json", {})).filter(([k]) => !lisToBio[k])));
  writeJSON("votes/lis.json", lisToBio);
  const y = new Date().getUTCFullYear();
  const cong = congressOf(y);
  const years = [1789 + (cong - 1) * 2, 1790 + (cong - 1) * 2].filter(x => x <= y);
  for (const yr of years) {
    try { await refreshHouse(yr); } catch (e) { log(`house ${yr} failed: ${e.message}`); }
    try { await refreshSenate(yr, lisToBio); } catch (e) { log(`senate ${yr} failed: ${e.message}`); }
  }
  return buildVoteFiles(members);
}
