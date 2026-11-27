// Bills and member sponsorship stats from the Congress.gov API (uses the api.data.gov key).
import { get, log, readJSON, writeJSON, setBudget, budgetLeft, OutOfBudget } from "./util.mjs";
import { congressOf } from "./votes.mjs";

const API = "https://api.congress.gov/v3";
const HOST = "api.congress.gov";
const LABEL = { hr: "H.R.", s: "S.", hres: "H.Res.", sres: "S.Res.", hjres: "H.J.Res.", sjres: "S.J.Res.", hconres: "H.Con.Res.", sconres: "S.Con.Res." };
const split = id => { const m = id.match(/^([a-z]+)(\d+)$/); return m ? [m[1], m[2]] : null; };
const strip = h => String(h || "").replace(/<\/(p|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();

async function cg(path, key, params = {}) {
  const q = new URLSearchParams({ format: "json", ...params, api_key: key });
  return get(`${API}${path}?${q}`);
}

async function fetchBill(cong, id, key) {
  const [t, n] = split(id);
  const { bill: b } = await cg(`/bill/${cong}/${t}/${n}`, key);
  let summary = "";
  if (b.summaries?.count) {
    const s = await cg(`/bill/${cong}/${t}/${n}/summaries`, key);
    const last = (s.summaries || []).sort((a, c) => (a.updateDate || "").localeCompare(c.updateDate || "")).pop();
    summary = strip(last?.text);
  }
  return {
    id, num: `${LABEL[t] || t.toUpperCase()} ${n}`, t, n: +n,
    title: b.title,
    sponsor: b.sponsors?.[0]?.bioguideId || null,
    intro: b.introducedDate || null,
    latest: b.latestAction ? { d: b.latestAction.actionDate, t: b.latestAction.text } : null,
    area: b.policyArea?.name || null,
    law: (b.laws || []).map(l => l.number)[0] || null,
    upd: b.updateDateIncludingText || b.updateDate || null,
    summary: summary.slice(0, 6000),
    at: new Date().toISOString(),
  };
}

async function lawsThisCongress(cong, key) {
  const ids = [];
  for (let offset = 0; offset < 1000; offset += 250) {
    const r = await cg(`/law/${cong}`, key, { limit: 250, offset });
    for (const b of r.bills || []) ids.push(`${b.type.toLowerCase()}${b.number}`);
    if (!r.pagination?.next) break;
  }
  return ids;
}

export async function refreshBills(members, voteInfo, key, { budget = 2500 } = {}) {
  if (!key) { log("bills: no DATA_GOV_API_KEY set, skipping"); return; }
  setBudget(HOST, budget, 750);
  const cong = congressOf(new Date().getUTCFullYear());
  const bills = readJSON("bills.json", {});
  const lastVote = {};
  for (const v of voteInfo.index) if (v.bill && !(lastVote[v.bill] > v.date)) lastVote[v.bill] = v.date;

  let laws = [];
  try { laws = await lawsThisCongress(cong, key); } catch (e) { log(`bills: law list failed: ${e.message}`); }
  const wanted = [...new Set([...laws, ...voteInfo.billsWithVotes])].filter(split);
  const stale = id => {
    const b = bills[id]; if (!b) return true;
    if (lastVote[id] && lastVote[id] > (b.at || "").slice(0, 10)) return true;
    return Date.now() - new Date(b.at || 0) > 7 * 864e5; // weekly re-check otherwise
  };
  const queue = wanted.filter(stale).sort((a, b) => (lastVote[b] || "").localeCompare(lastVote[a] || ""));
  let done = 0;
  for (const id of queue) {
    if (budgetLeft(HOST) < 400) break; // keep room for member stats
    try {
      const b = await fetchBill(cong, id, key);
      writeJSON(`bills/${id}.json`, { summary: b.summary });
      delete b.summary; bills[id] = b; done++;
    } catch (e) {
      if (e instanceof OutOfBudget) break;
      if (/^(401|403)/.test(e.message)) { log("bills: the API key was rejected"); return; }
      log(`bills: ${id} failed: ${e.message}`);
    }
  }
  for (const id of laws) if (bills[id]) bills[id].lawThisCongress = 1;
  writeJSON("bills.json", bills);
  log(`bills: ${done} refreshed, ${Object.keys(bills).length} known, ${queue.length - done} still waiting`);

  // Member stats: bills sponsored this Congress and how many became law.
  const stats = readJSON("member_stats.json", {});
  const mq = [...members].sort((a, b) => (stats[a.id]?.at || "").localeCompare(stats[b.id]?.at || ""));
  let ms = 0;
  for (const m of mq) {
    if (budgetLeft(HOST) < 5) break;
    if (stats[m.id] && Date.now() - new Date(stats[m.id].at) < 3 * 864e5) continue;
    try {
      const r = await cg(`/member/${m.id}/sponsored-legislation`, key, { limit: 250 });
      const items = (r.sponsoredLegislation || []).filter(x => x.congress === cong && x.type);
      stats[m.id] = {
        sponsored: items.length,
        laws: items.filter(x => /became public law|signed by president/i.test(x.latestAction?.text || "")).length,
        at: new Date().toISOString(),
      };
      ms++;
    } catch (e) {
      if (e instanceof OutOfBudget) break;
      log(`stats: ${m.id} failed: ${e.message}`);
    }
  }
  writeJSON("member_stats.json", stats);
  log(`member stats: ${ms} refreshed`);
}
