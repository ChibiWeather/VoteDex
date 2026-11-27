// Daily data refresh. Run by .github/workflows/refresh.yml, or locally:
//   DATA_GOV_API_KEY=... node scripts/refresh.mjs [members votes donors bills states]
import { log, writeJSON, readJSON } from "./lib/util.mjs";
import { refreshMembers } from "./lib/members.mjs";
import { refreshVotes, buildVoteFiles } from "./lib/votes.mjs";
import { refreshDonors } from "./lib/donors.mjs";
import { refreshBills } from "./lib/bills.mjs";
import { refreshStates } from "./lib/states.mjs";
import { refreshPortraits } from "./lib/portraits.mjs";
import { buildZips } from "./lib/zips.mjs";

const key = process.env.DATA_GOV_API_KEY || "";
const osKey = process.env.OPENSTATES_API_KEY || "";
const only = new Set(process.argv.slice(2));
// "backfill" = the temporary evening run that fills in donors for members never fetched yet.
// Once every member has donors it does nothing, and the single morning run handles the
// election-aware donor schedule on its own.
if (only.has("backfill")) {
  const st = readJSON("donors/_status.json", {});
  const left = readJSON("members.json", []).filter(m => (m.fec || (m.fecs || []).length) && !st[m.id]?.at).length;
  if (!left) { log("donor backfill complete: nothing to do in the evening run"); process.exit(0); }
  log(`donor backfill: ${left} members still need donors`);
  only.delete("backfill"); only.add("donors");
}
const want = s => !only.size || only.has(s);
const meta = readJSON("meta.json", {});
const stamp = s => { meta[s] = new Date().toISOString(); };

let members = readJSON("members.json", []);
if (want("members")) { try { members = await refreshMembers(); stamp("members"); } catch (e) { log(`members failed: ${e.message}`); } }

let voteInfo = { index: readJSON("votes/index.json", []), billsWithVotes: [] };
if (want("votes")) { try { voteInfo = await refreshVotes(members); stamp("votes"); } catch (e) { log(`votes failed: ${e.message}`); } }
else voteInfo = buildVoteFiles(members);

if (want("bills")) { try { await refreshBills(members, voteInfo, key); if (key) stamp("bills"); } catch (e) { log(`bills failed: ${e.message}`); } }
if (want("donors")) { try { await refreshDonors(members, key); if (key) stamp("donors"); } catch (e) { log(`donors failed: ${e.message}`); } }
if (want("portraits")) { try { await refreshPortraits(members); } catch (e) { log(`portraits failed: ${e.message}`); } }
// ZIP lookup: built once (or when asked by name, e.g. after redistricting).
if (want("zips")) { try { await buildZips({ force: only.has("zips") }); } catch (e) { log(`zips failed: ${e.message}`); } }
if (want("states")) { try { await refreshStates(osKey); stamp("states"); } catch (e) { log(`states failed: ${e.message}`); } }

writeJSON("meta.json", meta);
log("done");
