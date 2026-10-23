/**
 * Offline: build every centre distance table a cube size needs and write it as a gzipped file
 * named by the hash of its cache key, into web/tables/. The page fetches them on demand instead
 * of running the (slow) BFS. Run `npx tsx scripts/gen-tables.ts 4,5,6,7`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { buildTable, tableHash, tableSpecs } from "../web/src/solvers/centres.js";

const sizes = (process.argv[2] ?? "4,5,6,7").split(",").map(Number);
mkdirSync("web/tables", { recursive: true });
const index: Record<number, string[]> = existsSync("web/tables/index.json") ? JSON.parse(require("node:fs").readFileSync("web/tables/index.json", "utf8")) : {};
for (const size of sizes) {
  const t0 = Date.now();
  const names: string[] = [];
  for (const spec of tableSpecs(size)) {
    const name = tableHash(spec.key);
    names.push(name);
    const file = `web/tables/${name}.bin.gz`;
    if (existsSync(file)) continue;
    const table = buildTable(spec.stage, spec.perms);
    writeFileSync(file, gzipSync(table, { level: 9 }));
    console.log(`${size}x${size} stage ${spec.stage + 1}: ${name} (${table.length} entries, ${(Date.now() - t0) / 1000 | 0} s)`);
  }
  index[size] = names;
}
writeFileSync("web/tables/index.json", JSON.stringify(index));
console.log("index", index);
