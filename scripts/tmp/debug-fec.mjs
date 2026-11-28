const key = process.env.DATA_GOV_API_KEY;
const A = "https://api.open.fec.gov/v1";
async function q(path, params) {
  const u = new URL(A + path);
  for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) u.searchParams.append(k, x);
  u.searchParams.set("api_key", key);
  const r = await fetch(u); const t = await r.text();
  console.log("\n### " + path + " " + JSON.stringify(params) + " -> " + r.status);
  try { const j = JSON.parse(t); console.log(JSON.stringify({ pagination: j.pagination, results: (j.results || []).slice(0, 12) }, (k, v) => (typeof v === "string" && v.length > 120 ? v.slice(0, 120) : v)).slice(0, 6000)); } catch { console.log(t.slice(0, 500)); }
}
await q("/committees/", { q: "AIPAC", per_page: 5 });
await q("/committees/", { q: "NRA Political Victory", per_page: 5 });
await q("/committees/", { q: "United Democracy Project", per_page: 5 });
await q("/schedules/schedule_a/", { committee_id: "C00573949", two_year_transaction_period: 2026, is_individual: false, per_page: 30, sort: "-contribution_receipt_amount" });
await q("/schedules/schedule_a/", { committee_id: "C00394957", two_year_transaction_period: 2026, is_individual: false, per_page: 30, sort: "-contribution_receipt_amount" });
await q("/schedules/schedule_e/by_candidate/", { candidate_id: "H6NJ05171", cycle: 2024, per_page: 20, sort: "-total" });
await q("/schedules/schedule_e/by_candidate/", { candidate_id: "H6NJ05171", cycle: 2026, per_page: 20, sort: "-total" });
