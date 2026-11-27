// Official portraits (public domain) from the unitedstates/images project, saved at
// card size so the site doesn't depend on another host. Only new members are fetched.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT, log, writeJSON } from "./util.mjs";

const DIR = path.join(ROOT, "site", "img", "p");
export const W = 160, H = 195;

export async function refreshPortraits(members) {
  fs.mkdirSync(DIR, { recursive: true });
  let added = 0, missing = 0;
  for (const m of members) {
    const out = path.join(DIR, `${m.id}.jpg`);
    if (fs.existsSync(out)) continue;
    try {
      const res = await fetch(`https://unitedstates.github.io/images/congress/450x550/${m.id}.jpg`);
      if (!res.ok) { missing++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize(W, H, { fit: "cover", position: "top" }).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
      added++;
    } catch (e) { missing++; }
  }
  const have = fs.readdirSync(DIR).filter(f => f.endsWith(".jpg")).map(f => f.slice(0, -4)).sort();
  writeJSON("portraits.json", have);
  // The old pixel versions are no longer used.
  fs.rmSync(path.join(ROOT, "site", "img", "m"), { recursive: true, force: true });
  log(`portraits: +${added}, ${have.length} total, ${missing} without a photo`);
}

// State lawmakers: Open States lists a photo link for most of them (usually the
// legislature's own member photo). Saved at the same card size as site/img/s/<id>.jpg.
export async function refreshStatePhotos(st, people) {
  const dir = path.join(ROOT, "site", "img", "s");
  fs.mkdirSync(dir, { recursive: true });
  let added = 0, failed = 0, noLink = 0;
  for (const p of people) {
    const id = (p.id || "").replace(/^ocd-person\//, "");
    if (!id) continue;
    const out = path.join(dir, `${id}.jpg`);
    if (fs.existsSync(out)) continue;
    if (!p.image) { noLink++; continue; }
    try {
      const res = await fetch(p.image, { headers: { "User-Agent": "VoteDex data refresh" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { failed++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize(W, H, { fit: "cover", position: "top" }).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
      added++;
    } catch (e) { failed++; if (failed <= 3) log(`${st} photo ${p.image}: ${e.message}`); }
  }
  const ids = new Set(people.map(p => (p.id || "").replace(/^ocd-person\//, "")));
  const have = fs.readdirSync(dir).filter(f => f.endsWith(".jpg")).map(f => f.slice(0, -4)).filter(id => ids.has(id)).sort();
  writeJSON(`${st}_photos.json`, have);
  log(`${st} photos: +${added}, ${have.length} of ${people.length} have one, ${noLink} without a link, ${failed} failed`);
}
