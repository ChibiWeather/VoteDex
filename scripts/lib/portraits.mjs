// 8-bit portraits: official public-domain photos from the unitedstates/images
// project, shrunk to a small pixel grid. Only members without one are fetched.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ROOT, get, log, writeJSON, setBudget } from "./util.mjs";

const DIR = path.join(ROOT, "site", "img", "m");
export const W = 20, H = 24; // pixel grid

export async function refreshPortraits(members) {
  fs.mkdirSync(DIR, { recursive: true });
  setBudget("unitedstates.github.io", 700, 150);
  let added = 0, missing = 0;
  for (const m of members) {
    const out = path.join(DIR, `${m.id}.png`);
    if (fs.existsSync(out)) continue;
    try {
      const res = await fetch(`https://unitedstates.github.io/images/congress/225x275/${m.id}.jpg`);
      if (!res.ok) { missing++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize(W, H, { fit: "cover", position: "top" }).png({ palette: true, colors: 24, dither: 0 }).toFile(out);
      added++;
    } catch (e) { missing++; }
  }
  const have = fs.readdirSync(DIR).filter(f => f.endsWith(".png")).map(f => f.slice(0, -4)).sort();
  writeJSON("portraits.json", have);
  log(`portraits: +${added}, ${have.length} total, ${missing} without a photo`);
}
