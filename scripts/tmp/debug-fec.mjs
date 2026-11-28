const key = process.env.DATA_GOV_API_KEY;
const A = "https://api.open.fec.gov/v1";
const F = ["committee_id","name","contributor_name","entity_type","contribution_receipt_amount","receipt_type","line_number","memo_code","memo_text","recipient_name","disbursement_amount","disbursement_description","committee_name","support_oppose_indicator","total","count","conduit_committee_name","contributor_aggregate_ytd"];
async function q(path, params, n = 12) {
  const u = new URL(A + path);
  for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) u.searchParams.append(k, x);
  u.searchParams.set("api_key", key);
  const r = await fetch(u); const t = await r.text();
  console.log("\nQQ " + path + " " + JSON.stringify(params) + " -> " + r.status);
  try { const j = JSON.parse(t); console.log("count", j.pagination?.count); for (const x of (j.results || []).slice(0, n)) console.log(JSON.stringify(Object.fromEntries(F.filter(k => x[k] != null).map(k => [k, typeof x[k] === "string" ? x[k].slice(0, 90) : x[k]])))); return j; } catch { console.log(t.slice(0, 500)); }
}
const s = await q("/committees/", { q: "American Israel Public Affairs", per_page: 5 });
await q("/schedules/schedule_a/", { committee_id: "C00573949", two_year_transaction_period: 2026, line_number: "F3-11C", per_page: 20, sort: "-contribution_receipt_amount" });
await q("/schedules/schedule_a/", { committee_id: "C00573949", two_year_transaction_period: 2024, line_number: "F3-11C", per_page: 20, sort: "-contribution_receipt_amount" });
await q("/schedules/schedule_a/", { committee_id: "C00394957", two_year_transaction_period: 2026, line_number: "F3-11C", per_page: 20, sort: "-contribution_receipt_amount" });
for (const c of (s?.results || []).slice(0, 2)) {
  for (const y of [2024, 2026]) await q("/schedules/schedule_b/", { committee_id: c.committee_id, recipient_committee_id: "C00573949", two_year_transaction_period: y, per_page: 10 }, 5);
  await q("/schedules/schedule_b/by_recipient_id/", { committee_id: c.committee_id, recipient_id: "C00573949", per_page: 10 }, 5);
}
await q("/schedules/schedule_a/", { committee_id: "C00573949", two_year_transaction_period: 2024, contributor_type: "individual", per_page: 5, sort: "-contribution_receipt_amount", q_memo_text: "AIPAC" }, 5);
