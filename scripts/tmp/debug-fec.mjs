const key = process.env.DATA_GOV_API_KEY;
const A = "https://api.open.fec.gov/v1";
async function q(path, params, n = 40) {
  const u = new URL(A + path);
  for (const [k, v] of Object.entries(params)) for (const x of [].concat(v)) u.searchParams.append(k, x);
  u.searchParams.set("api_key", key);
  const r = await fetch(u); const t = await r.text();
  console.log("\nQQ " + path + " " + JSON.stringify(params) + " -> " + r.status);
  try { const j = JSON.parse(t); console.log("count", j.pagination?.count, "keys", Object.keys(j.results?.[0] || {}).join(",")); for (const x of (j.results || []).slice(0, n)) console.log([x.committee_id, x.committee_name || x.name, x.total, x.count, x.cycle, x.committee_type, x.designation, x.support_oppose_indicator].join(" | ")); return j; } catch { console.log(t.slice(0, 500)); }
}
const r = await q("/schedules/schedule_b/by_recipient_id/", { recipient_id: "C00573949", cycle: 2024, sort: "-total", per_page: 100 });
const ids = (r?.results || []).slice(0, 40).map(x => x.committee_id);
await q("/committees/", { committee_id: ids, per_page: 100 }, 40);
await q("/schedules/schedule_b/by_recipient_id/", { recipient_id: "C00394957", cycle: 2026, sort: "-total", per_page: 100 }, 30);
await q("/schedules/schedule_e/by_candidate/", { candidate_id: "H0LA01087", cycle: 2024, sort: "-total", per_page: 20 }, 10);
