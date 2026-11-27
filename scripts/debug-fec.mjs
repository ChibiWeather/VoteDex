// One-off check of the donor step against three members. Prints a short summary.
import { memberDonors } from "./lib/donors.mjs";
import { readJSON } from "./lib/util.mjs";
const key = process.env.DATA_GOV_API_KEY;
const M = readJSON("members.json", []);
for (const id of ["P000614", "S001181", "G000604", "C001098"]) {
  const m = M.find(x => x.id === id);
  try {
    const d = await memberDonors(m, key, {});
    console.log("==", id, m.fecs, JSON.stringify({ cycle: d.cycle, cand: d.cand, committee: d.committee, totals: d.totals, top: d.employers.slice(0, 3), n: d.employers.length }));
  } catch (e) { console.log("==", id, "ERROR", e.message); }
}
