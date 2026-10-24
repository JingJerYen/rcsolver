// Copies web/index.html to public/ with ?v=<build id> on app.js and styles.css so browsers never serve stale assets,
// and writes the offline service worker with the list of files it keeps and a version covering all of them.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

mkdirSync("public", { recursive: true });
copyFileSync("web/styles.css", "public/styles.css");
cpSync("web/tables", "public/tables", { recursive: true });
cpSync("web/icons", "public/icons", { recursive: true });
copyFileSync("web/manifest.webmanifest", "public/manifest.webmanifest");
const v = createHash("sha1")
  .update(readFileSync("public/app.js"))
  .update(readFileSync("public/solveWorker.js"))
  .update(readFileSync("public/styles.css"))
  .digest("hex")
  .slice(0, 10);
// the page names its worker script by a literal; version it the same way so the pair stays matched
const appJs = readFileSync("public/app.js", "utf8");
if (!appJs.includes('"./solveWorker.js"')) throw new Error("worker url literal not found in app.js");
writeFileSync("public/app.js", appJs.replace('"./solveWorker.js"', `"./solveWorker.js?v=${v}"`));
const html = readFileSync("web/index.html", "utf8")
  .replace('href="./styles.css"', `href="./styles.css?v=${v}"`)
  .replace('src="./app.js"', `src="./app.js?v=${v}"`);
writeFileSync("public/index.html", html);

// Everything the app needs without a network: the page, its versioned files, the icons and every solver table.
const icons = ["icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
const tables = readdirSync("public/tables").filter((f) => f.endsWith(".bin.gz")).sort().map((f) => `tables/${f}`);
const precache = ["./", `app.js?v=${v}`, `solveWorker.js?v=${v}`, `styles.css?v=${v}`, "manifest.webmanifest", ...icons, ...tables];
const swHash = createHash("sha1").update(v);
for (const f of ["public/index.html", "public/manifest.webmanifest", ...icons.map((f) => `public/${f}`), ...tables.map((f) => `public/${f}`)]) swHash.update(readFileSync(f));
const swVersion = swHash.digest("hex").slice(0, 10);
const sw = readFileSync("web/sw.js", "utf8");
if (!sw.includes('"__VERSION__"') || !sw.includes("__PRECACHE__")) throw new Error("placeholders not found in web/sw.js");
writeFileSync("public/sw.js", sw.replace('"__VERSION__"', JSON.stringify(swVersion)).replace("__PRECACHE__", JSON.stringify(precache)));
console.log(`stamped assets with v=${v}, offline copy ${swVersion} (${precache.length} files)`);
