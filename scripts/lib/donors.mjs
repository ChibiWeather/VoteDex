// Campaign money from the FEC (api.open.fec.gov, uses the api.data.gov key).
// Writes data/donors/<bioguide>.json. The FEC allows about 1,000 requests an hour,
// so each run refreshes the members whose data is oldest, within a fixed budget.
import { get, log, readJSON, writeJSON, setBudget, budgetLeft, OutOfBudget } from "./util.mjs";

const API = "https://api.open.fec.gov/v1";
const HOST = "api.open.fec.gov";
// Lines that say nothing about who the donor works for.
const SKIP = /^(N\/?A|N\.A\.?|NONE|NULL|UNKNOWN|NOT EMPLOYED|UNEMPLOYED|RETIRED|SELF[- ]?EMPLOYED|SELF|ENTREPRENEUR|HOMEMAKER|INFORMATION REQUESTED.*|REQUESTED|NOT PROVIDED|REFUSED|BEST EFFORTS?|STUDENT|DISABLED|\s*)$/i;

export function currentCycle(d = new Date()) {
  const y = d.getUTCFullYear();
  return y % 2 ? y + 1 : y;
}

async function fec(path, params, key) {
  const q = new URLSearchParams({ ...params, api_key: key });
  return get(`${API}${path}?${q}`);
}

async function principalCommittee(cand, key) {
  const r = await fec(`/candidate/${cand}/committees/`, { designation: "P", per_page: 5 }, key);
  const c = (r.results || []).sort((a, b) => (b.last_file_date || "").localeCompare(a.last_file_date || ""))[0];
  return c ? c.committee_id : null;
}

async function memberDonors(m, key, cache) {
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
  };
}

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
  const queue = members.filter(m => (m.fec || (m.fecs || []).length) && (!status[m.id]?.at || status[m.id].err || Date.now() - new Date(status[m.id].at) > maxAge)).sort((a, b) => (status[a.id]?.at || "").localeCompare(status[b.id]?.at || ""));
  let done = 0, failed = 0;
  const stopAt = Date.now() + 30 * 60e3; // never hold up the daily run for long
  for (const m of queue) {
    if (budgetLeft(HOST) < 3 || Date.now() > stopAt) break;
    try {
      const d = await memberDonors(m, key, status[m.id] || {});
      if (d) writeJSON(`donors/${m.id}.json`, d);
      status[m.id] = { at: new Date().toISOString(), cand: d?.cand || null, committee: d?.committee || null };
      done++;
    } catch (e) {
      if (e instanceof OutOfBudget) { if (e.constructor.name === "RateLimited") log("donors: FEC hourly limit reached, continuing next run"); break; }
      if (/^(401|403)/.test(e.message)) { log("donors: the API key was rejected (check the DATA_GOV_API_KEY secret)"); break; }
      status[m.id] = { ...(status[m.id] || {}), at: new Date().toISOString(), err: e.message.slice(0, 400) };
      failed++;
    }
  }
  writeJSON("donors/_status.json", status);
  log(`donors: refreshed ${done}, failed ${failed}, ${queue.length} were due (refresh every ${maxAgeDays()} day(s))`);
}
