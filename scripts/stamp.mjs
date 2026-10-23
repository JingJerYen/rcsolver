// Copies web/index.html to public/ with ?v=<build id> on app.js and styles.css so browsers never serve stale assets.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync } from "node:fs";
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
console.log(`stamped assets with v=${v}`);
