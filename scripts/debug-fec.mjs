// One-off check of the FEC endpoints the donor step uses. Prints status and a short body.
const key = process.env.DATA_GOV_API_KEY;
const urls = [
  "/candidate/H8NH01210/committees/?designation=P&per_page=5",
  "/candidate/H8NH01210/totals/?per_page=3&sort=-cycle",
  "/candidate/S0NH00219/totals/?per_page=3&sort=-cycle",
  "/schedules/schedule_a/by_employer/?committee_id=C00662577&cycle=2026&per_page=40&sort=-total",
  "/schedules/schedule_a/by_employer/?committee_id=C00662577&cycle=2026&per_page=40",
  "/schedules/schedule_a/by_employer/?committee_id=C00662577&cycle=2026",
];
for (const u of urls) {
  const r = await fetch(`https://api.open.fec.gov/v1${u}&api_key=${key}`);
  const t = await r.text();
  console.log("\n==", r.status, u, "\n", t.slice(0, 900));
}
