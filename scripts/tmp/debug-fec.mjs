import { memberDonors } from "../lib/donors.mjs";
import { readJSON } from "../lib/util.mjs";
const M = readJSON("members.json", []);
for (const id of ["G000583", "S001176", "S001181"]) {
  const m = M.find(x => x.id === id);
  const d = await memberDonors(m, process.env.DATA_GOV_API_KEY, {});
  console.log("\nQQ", m.n, d.cycle, d.committee, "jfc", d.jfc);
  for (const p of d.pacs.slice(0, 8)) console.log("  pac", JSON.stringify(p));
  console.log("  kinds", JSON.stringify(d.pacs.reduce((a, p) => (a[p[3]] = (a[p[3]] || 0) + 1, a), {})), "pass", d.pacs.filter(p => p[5]).map(p => p[0] + " " + p[1]).join("; "));
  console.log("  outside", d.outside.cycle, "for", JSON.stringify(d.outside.for.slice(0, 4)), "against", JSON.stringify(d.outside.against.slice(0, 4)));
}
