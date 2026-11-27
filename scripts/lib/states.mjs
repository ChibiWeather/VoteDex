// State legislatures from Open States. Members come from the free bulk CSV (no key).
// Votes need a free Open States API key (OPENSTATES_API_KEY); without it they are skipped.
import { get, log, readJSON, writeJSON, setBudget, party, OutOfBudget } from "./util.mjs";

export const STATES = ["nh"];

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

async function refreshPeople(st) {
  const csv = await get(`https://data.openstates.org/people/current/${st}.csv`, { type: "text" });
  const rows = parseCSV(csv).map(r => [
    r.name, party(r.current_party), r.current_district, r.current_chamber === "upper" ? "S" : "H",
    r.email || "", r.capitol_voice || r.district_voice || "", r.id,
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  if (rows.length < 50) throw new Error(`${st}: only ${rows.length} people`);
  writeJSON(`${st}_legislature.json`, rows);
  log(`${st}: ${rows.length} legislators`);
  return rows;
}

const opt = o => /^yes$/i.test(o) ? "Y" : /^no$/i.test(o) ? "N" : /present/i.test(o) ? "P" : "X";

async function refreshStateVotes(st, key) {
  setBudget("v3.openstates.org", 60, 6500); // free tier: 10 per minute
  const H = { "X-API-KEY": key };
  const j = await get(`https://v3.openstates.org/jurisdictions/${st}?include=legislative_sessions`, { headers: H });
  // Newest session that has started. A brand-new session (e.g. one that opens in January)
  // has no votes yet, so fall back to the one before it until the new one has some.
  const today = new Date().toISOString().slice(0, 10);
  const sessions = (j.legislative_sessions || []).filter(s => s.start_date && s.start_date <= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const prior = readJSON(`${st}_votes.json`, null);
  let session = sessions.pop()?.identifier;
  if (!session) return;
  if (prior && prior.session !== session && Object.keys(prior.votes || {}).length) {
    const probe = await get(`https://v3.openstates.org/bills?${new URLSearchParams({ jurisdiction: st, session, include: "votes", per_page: 20 })}`, { headers: H });
    if (!(probe.results || []).some(b => (b.votes || []).length)) session = prior.session;
  } else if (!prior || !Object.keys(prior.votes || {}).length) {
    const probe = await get(`https://v3.openstates.org/bills?${new URLSearchParams({ jurisdiction: st, session, include: "votes", per_page: 20 })}`, { headers: H });
    if (!(probe.results || []).some(b => (b.votes || []).length) && sessions.length) session = sessions.pop().identifier;
  }
  const store = readJSON(`${st}_votes.json`, { session, votes: {}, people: {} });
  if (store.session !== session) Object.assign(store, { session, votes: {}, people: {} });
  let added = 0;
  try {
    for (let page = 1; page <= 50; page++) {
      let known = 0;
      const r = await get(`https://v3.openstates.org/bills?${new URLSearchParams({ jurisdiction: st, session, sort: "latest_action_desc", include: "votes", per_page: 20, page })}`, { headers: H });
      let newOnPage = 0;
      for (const b of r.results || []) for (const v of b.votes || []) {
        if (store.votes[v.id]) { known++; continue; }
        if (!(v.votes || []).length) continue;
        const counts = Object.fromEntries((v.counts || []).map(c => [opt(c.option), c.value]));
        store.votes[v.id] = { bill: b.identifier, title: b.title, date: (v.start_date || "").slice(0, 10), q: v.motion_text, result: v.result, ch: v.organization?.classification === "upper" ? "S" : "H", t: counts };
        for (const p of v.votes) { const pid = p.voter?.id; if (pid) (store.people[pid] = store.people[pid] || {})[v.id] = opt(p.option); }
        newOnPage++; added++;
      }
      if (known && !newOnPage) break; // reached votes we already have
      if (page >= (r.pagination?.max_page || 1)) break;
    }
  } catch (e) { if (!(e instanceof OutOfBudget)) log(`${st} votes: ${e.message}`); }
  writeJSON(`${st}_votes.json`, store);
  log(`${st} votes: +${added}, ${Object.keys(store.votes).length} in session ${session}`);
}

export async function refreshStates(openStatesKey) {
  for (const st of STATES) {
    try { await refreshPeople(st); } catch (e) { log(`${st} people failed: ${e.message}`); }
    if (openStatesKey) { try { await refreshStateVotes(st, openStatesKey); } catch (e) { log(`${st} votes failed: ${e.message}`); } }
    else log(`${st} votes: no OPENSTATES_API_KEY set, skipping`);
  }
}
