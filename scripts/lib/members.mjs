// Current members of Congress, from the public congress-legislators dataset.
import { get, log, writeJSON, party } from "./util.mjs";

const SRC = "https://unitedstates.github.io/congress-legislators/legislators-current.json";

export async function refreshMembers() {
  const raw = await get(SRC);
  const out = raw.map(r => {
    const t = r.terms[r.terms.length - 1];
    const c = t.type === "sen" ? "s" : "r";
    const same = r.terms.filter(x => x.type === t.type);
    const fecIds = (r.id.fec || []).filter(f => f[0] === (c === "s" ? "S" : "H"));
    const m = {
      id: r.id.bioguide,
      n: r.name.official_full || `${r.name.first} ${r.name.last}`,
      l: r.name.last,
      fl: `${r.name.nickname || r.name.first} ${r.name.last}`,
      p: party(t.party),
      s: t.state,
      c,
      ph: t.phone || "",
      u: t.url || "",
      since: same[0].start.slice(0, 4),
      end: t.end.slice(0, 4),
      fec: fecIds[fecIds.length - 1] || (r.id.fec || []).slice(-1)[0] || "",
      os: r.id.opensecrets || "",
      gt: r.id.govtrack || null,
    };
    if (c === "s") { m.rk = t.state_rank || ""; m.lis = r.id.lis || ""; }
    else m.d = t.district;
    if (t.contact_form) m.cf = t.contact_form;
    // Independents who caucus with a party (e.g. Sanders, King) vote with that caucus.
    if (m.p === "I" && t.caucus) m.vp = party(t.caucus);
    return m;
  });
  if (out.length < 500) throw new Error(`members: only ${out.length} rows, refusing to overwrite`);
  writeJSON("members.json", out);
  log(`members: ${out.length}`);
  return out;
}
