// Campaign money from the FEC (api.open.fec.gov, uses the api.data.gov key).
// Writes data/donors/<bioguide>.json. The FEC allows about 1,000 requests an hour,
// so each run refreshes the members whose data is oldest, within a fixed budget.
import { get, log, readJSON, writeJSON, setBudget, budgetLeft, OutOfBudget } from "./util.mjs";

const API = "https://api.open.fec.gov/v1";
const HOST = "api.open.fec.gov";
const FIRST = new Set((process.env.DONORS_FIRST || "NH").split(",")); // states loaded first when many are due (the owner's state)
const V = 2; // bump when the file format gains fields, so everyone is fetched again
// Lines that say nothing about who the donor works for.
const SKIP = /^(N\/?A|N\.A\.?|NONE|NULL|UNKNOWN|NOT EMPLOYED|UNEMPLOYED|RETIRED|SELF[- ]?EMPLOYED|SELF|ENTREPRENEUR|HOMEMAKER|INFORMATION REQUESTED.*|REQUESTED|NOT PROVIDED|REFUSED|BEST EFFORTS?|STUDENT|DISABLED|\s*)$/i;

export function currentCycle(d = new Date()) {
  const y = d.getUTCFullYear();
  return y % 2 ? y + 1 : y;
}

async function fec(path, params, key) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) q.append(k, x);
  q.set("api_key", key);
  return get(`${API}${path}?${q}`);
}

async function principalCommittee(cand, key) {
  const r = await fec(`/candidate/${cand}/committees/`, { designation: "P", per_page: 5 }, key);
  const c = (r.results || []).sort((a, b) => (b.last_file_date || "").localeCompare(a.last_file_date || ""))[0];
  return c ? c.committee_id : null;
}

export async function memberDonors(m, key, cache) {
  // A member can have several FEC ids (e.g. a House member now running for Senate).
  // Use the one with money in the most recent two-year cycle.
  const ids = [...new Set([...(m.fecs || []), m.fec].filter(Boolean))];
  if (!ids.length) return null;
  let best = null;
  for (const id of ids) {
    const r = await fec(`/candidate/${id}/totals/`, { election_full: false, sort: "-cycle", per_page: 2 }, key);
    const row = (r.results || []).find(x => x.cycle && (x.receipts || 0) > 0);
    if (row && (!best || row.cycle > best.cycle || (row.cycle === best.cycle && row.receipts > best.receipts))) best = row;
  }
  const cand = best ? best.candidate_id : (m.fec || ids[ids.length - 1]);
  let committee = cache.cand === cand ? cache.committee : null;
  if (!committee) committee = await principalCommittee(cand, key);
  const cycle = best ? best.cycle : currentCycle();
  let employers = [];
  if (committee) {
    const r = await fec(`/schedules/schedule_a/by_employer/`, { committee_id: committee, cycle, per_page: 100, sort: "-total" }, key);
    employers = (r.results || [])
      .filter(x => x.employer && !SKIP.test(x.employer.trim()))
      .reduce((acc, x) => {
        // "Anthropic, PBC" and "Anthropic PBC" are the same employer
        const k = x.employer.toUpperCase().replace(/[.,'&]/g, " ").replace(/\b(INC|LLC|LLP|LP|PBC|CORP|CORPORATION|CO|COMPANY|LTD|PLLC|PC|THE)\b/g, "").replace(/\s+/g, " ").trim();
        const e = acc.get(k); if (e) { e[1] += x.total; e[2] += x.count; } else acc.set(k, [titleCase(x.employer.trim()), x.total, x.count]);
        return acc;
      }, new Map());
    employers = [...employers.values()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([e, t, c]) => [e, Math.round(t), c]);
  }
  const { pacs, jfc } = committee ? await pacMoney(committee, cand, cycle, key) : { pacs: [], jfc: 0 };
  const outside = await outsideMoney(cand, cycle, key);
  const n = v => Math.round(v || 0);
  const t = best;
  return {
    asOf: new Date().toISOString().slice(0, 10),
    cycle, cand, committee,
    totals: t ? {
      raised: n(t.receipts),
      small: n(t.individual_unitemized_contributions),
      large: n(t.individual_itemized_contributions),
      pacs: n(t.other_political_committee_contributions),
      party: n(t.political_party_committee_contributions),
      self: n((t.candidate_contribution || 0) + (t.loans_made_by_candidate || 0)),
      spent: n(t.disbursements),
      cash: n(t.last_cash_on_hand_end_period),
      through: (t.coverage_end_date || "").slice(0, 10),
    } : null,
    employers,
    pacs, jfc, outside,
  };
}

// Committee types, cached across runs (they rarely change): id -> [type, designation, candidate ids]
let CT = null;
async function committeeTypes(ids, key) {
  CT = CT || readJSON("donors/_committees.json", {});
  const need = ids.filter(id => !CT[id]);
  for (let i = 0; i < need.length; i += 100) {
    const r = await fec("/committees/", { committee_id: need.slice(i, i + 100), per_page: 100 }, key);
    for (const c of r.results || []) CT[c.committee_id] = [c.committee_type || "", c.designation || "", c.candidate_ids || []];
    for (const id of need.slice(i, i + 100)) CT[id] = CT[id] || ["", "", []];
  }
  return CT;
}
export function saveCommitteeTypes() { if (CT) writeJSON("donors/_committees.json", CT); }

// A PAC can give a candidate at most $5,000 per election (primary, general, maybe a runoff).
// Anything well past that (over $20,000 in one two-year cycle) from one PAC was passed through from individual donors ("earmarked").
const PAC_DIRECT_MAX = 20000; // with room for runoffs and late debt payments
const PLATFORM = /^(ACTBLUE|WINRED)\b/i;

// Money other committees sent this campaign, by name: PACs, other politicians' PACs, party.
// Joint fundraising committees only pass along money people gave, so they are summed, not listed.
async function pacMoney(committee, cand, cycle, key) {
  const r = await fec("/schedules/schedule_b/by_recipient_id/", { recipient_id: committee, cycle, sort: "-total", per_page: 100 }, key);
  const rows = (r.results || []).filter(x => x.total > 0 && !PLATFORM.test(x.committee_name || ""));
  const types = await committeeTypes([...new Set(rows.map(x => x.committee_id))], key);
  const pacs = []; let jfc = 0;
  for (const x of rows) {
    const [type, des, cands] = types[x.committee_id] || ["", "", []];
    if (cands.includes(cand) || des === "P" || des === "A") continue; // the member's own committees
    if (des === "J") { jfc += x.total; continue; }
    const kind = /^[XYZ]$/.test(type) ? "party" : des === "D" ? "lead" : type === "O" ? "super" : "pac";
    const pass = kind !== "party" && x.total > PAC_DIRECT_MAX ? 1 : 0;
    pacs.push([cleanName(x.committee_name || x.committee_id), Math.round(x.total), x.count, kind, x.committee_id, pass]);
  }
  pacs.sort((a, b) => b[1] - a[1]);
  return { pacs: pacs.slice(0, 60), jfc: Math.round(jfc) };
}

// Independent spending (mostly super PACs): ads and mail for or against the member.
// This is not given to the campaign, and the groups can't coordinate with it.
async function outsideMoney(cand, cycle, key) {
  const get1 = async c => (await fec("/schedules/schedule_e/by_candidate/", { candidate_id: cand, cycle: c, sort: "-total", per_page: 100 }, key)).results || [];
  let rows = await get1(cycle), used = cycle;
  if (!rows.length) { rows = await get1(cycle - 2); used = cycle - 2; }
  const by = { S: new Map(), O: new Map() };
  for (const x of rows) {
    const m = by[x.support_oppose_indicator]; if (!m || !(x.total > 0) || !x.committee_id) continue;
    const e = m.get(x.committee_id) || [cleanName(x.committee_name || x.committee_id), 0, x.committee_id];
    e[1] += x.total; m.set(x.committee_id, e);
  }
  const list = m => [...m.values()].map(([n, t, id]) => [n, Math.round(t), id]).sort((a, b) => b[1] - a[1]).slice(0, 30);
  return { cycle: used, for: list(by.S), against: list(by.O) };
}

const cleanName = s => titleCase(String(s || "Unnamed group").replace(/\bPOLITICAL ACTION COMMITTEE\b/gi, "PAC").replace(/\s+/g, " ").trim());
const KEEP_UPPER = /^(LLC|LLP|LP|INC|PAC|USA|US|UBS|IBM|AT&T|BNSF|CVS|UPS|NBC|CBS|ABC|GE|JP|DC|NH|NY|II|III|IV|AFL-CIO|SEIU|AFSCME|NEA|UAW|IBEW)$/;
function titleCase(s) {
  return s.toLowerCase().replace(/[a-z0-9&'.-]+/g, w => KEEP_UPPER.test(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));
}

// How old a member's donor data may get before we fetch it again.
// Daily from Aug 1 to Dec 15 of an election year (3 months before the general
// election through the post-general report), and for 10 days after each
// regular FEC deadline. Weekly the rest of the time.
const DEADLINES = ["01-31", "04-15", "07-15", "10-15"];
export function maxAgeDays(d = new Date()) {
  const y = d.getUTCFullYear(), md = d.toISOString().slice(5, 10);
  if (y % 2 === 0 && md >= "08-01" && md <= "12-15") return 1;
  for (const dl of DEADLINES) {
    const t = new Date(`${y}-${dl}T00:00:00Z`), days = (d - t) / 864e5;
    if (days >= 0 && days <= 10) return 1;
  }
  return 7;
}

export async function refreshDonors(members, key, { budget = 850 } = {}) {
  if (!key) { log("donors: no DATA_GOV_API_KEY set, skipping"); return; }
  setBudget(HOST, budget, 1200);
  const status = readJSON("donors/_status.json", {});
  // Oldest first; never-fetched members go first of all.
  const maxAge = maxAgeDays() * 864e5 - 2 * 3600e3; // a little slack so a daily run always counts
  const queue = members.filter(m => (m.fec || (m.fecs || []).length) && (!status[m.id]?.at || status[m.id].err || (status[m.id].v || 1) < V || Date.now() - new Date(status[m.id].at) > maxAge)).sort((a, b) => (status[a.id]?.v || 0) - (status[b.id]?.v || 0) || (FIRST.has(b.s) - FIRST.has(a.s)) || (status[a.id]?.at || "").localeCompare(status[b.id]?.at || ""));
  let done = 0, failed = 0;
  const stopAt = Date.now() + 30 * 60e3; // never hold up the daily run for long
  for (const m of queue) {
    if (budgetLeft(HOST) < 8 || Date.now() > stopAt) break;
    try {
      const d = await memberDonors(m, key, status[m.id] || {});
      if (d) writeJSON(`donors/${m.id}.json`, d);
      status[m.id] = { at: new Date().toISOString(), cand: d?.cand || null, committee: d?.committee || null, v: V };
      done++;
    } catch (e) {
      if (e instanceof OutOfBudget) { if (e.constructor.name === "RateLimited") log("donors: FEC hourly limit reached, continuing next run"); break; }
      if (/^(401|403)/.test(e.message)) { log("donors: the API key was rejected (check the DATA_GOV_API_KEY secret)"); break; }
      status[m.id] = { ...(status[m.id] || {}), at: new Date().toISOString(), err: e.message.slice(0, 400) };
      failed++;
    }
  }
  writeJSON("donors/_status.json", status);
  saveCommitteeTypes();
  log(`donors: refreshed ${done}, failed ${failed}, ${queue.length} were due (refresh every ${maxAgeDays()} day(s))`);
}
