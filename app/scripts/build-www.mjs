// Builds the app's web folder (app/www) from the live site's pages.
// The pages ship inside the app; vote and bill data still load from
// https://chibiweather.github.io/VoteDex/ so the app is always up to date.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(app, "..", "site");
const www = join(app, "www");

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

// Capacitor's small helper script, so the page can talk to the iCloud plugin.
copyFileSync(join(app, "node_modules/@capacitor/core/dist/capacitor.js"), join(www, "capacitor.js"));

let index = readFileSync(join(site, "index.html"), "utf8");
if (!index.includes("<script>")) throw new Error("index.html has no <script> tag");
index = index.replace("<script>", '<script src="capacitor.js"></script>\n<script>');
writeFileSync(join(www, "index.html"), index);
copyFileSync(join(site, "privacy.html"), join(www, "privacy.html"));
console.log("Built app/www");
