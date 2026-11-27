// Draws the pixel-art app icon and launch screen. Run: node app/scripts/make-art.cjs
const sharp = require("../../node_modules/sharp");
const path = require("path");
const C = { ".": "#0e1320", p: "#171e30", y: "#ffd23f", c: "#f3ecd8", g: "#3ee07a", b: "#3d7bff", r: "#ff4b3e" };
// 16 x 16: a ballot with a green check going into a ballot box
const G = [
  "................",
  "................",
  ".....cccccc.....",
  ".....cccccc.....",
  ".....ccccgc.....",
  ".....cgcgcc.....",
  ".....ccgccc.....",
  ".....cccccc.....",
  "..yyyyyyyyyyyy..",
  "..yppp....pppy..",
  "..yppppppppppy..",
  "..ypbbbbrrrrpy..",
  "..yppppppppppy..",
  "..yppppppppppy..",
  "..yyyyyyyyyyyy..",
  "................",
];
function svg(size, cells, pad) {
  const n = 16, px = Math.floor((size - pad * 2) / n), off = Math.floor((size - px * n) / 2);
  let r = "";
  G.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== ".") r += `<rect x="${off + x * px}" y="${off + y * px}" width="${px}" height="${px}" fill="${C[ch]}"/>`;
  }));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${C["."]}"/>${r}</svg>`);
}
const A = path.join(__dirname, "../ios/App/App/Assets.xcassets");
(async () => {
  await sharp(svg(1024, G, 0)).flatten({ background: C["."] }).removeAlpha().png().toFile(path.join(A, "AppIcon.appiconset/AppIcon-512@2x.png"));
  const splash = await sharp(svg(2732, G, 1046)).flatten({ background: C["."] }).removeAlpha().png().toBuffer();
  for (const f of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"])
    await sharp(splash).toFile(path.join(A, "Splash.imageset", f));
  await sharp(svg(1024, G, 0)).png().toFile(path.join(__dirname, "../art/icon-1024.png"));
  console.log("done");
})();
