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
