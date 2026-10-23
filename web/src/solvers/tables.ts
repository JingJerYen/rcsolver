/**
 * Centre distance tables for 4×4 and up. They are built offline (scripts/gen-tables.ts) and shipped
 * as gzipped files named by the hash of their cache key; the page fetches the ones a size needs the
 * first time that size comes up. Should a fetch fail, the table is built in the browser instead.
 */
import { buildTable, hasTable, installTable, tableHash, tableSpecs } from "./centres.js";

const pending = new Map<number, Promise<void>>();

async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  // a server may already have unpacked it (Content-Encoding) — then the magic number is gone
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Make every table the size needs available, fetching precomputed ones where possible. */
export function ensureTables(size: number, base = "./tables/", onProgress?: (fraction: number) => void): Promise<void> {
  if (size < 4) return Promise.resolve();
  let p = pending.get(size);
  if (p) return p;
  p = (async () => {
    const specs = new Map(tableSpecs(size).map((s) => [s.key, s]));
    let done = 0;
    const total = specs.size;
    await Promise.all(
      Array.from(specs.values()).map(async (spec) => {
        if (hasTable(spec.key)) {
          onProgress?.(++done / total);
          return;
        }
        try {
          const res = await fetch(`${base}${tableHash(spec.key)}.bin.gz`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const table = await gunzip(await res.arrayBuffer());
          if (!table.length) throw new Error("empty table");
          installTable(spec.key, table);
        } catch {
          installTable(spec.key, buildTable(spec.stage, spec.perms));
        }
        onProgress?.(++done / total);
      }),
    );
  })();
  pending.set(size, p);
  p.catch(() => pending.delete(size));
  return p;
}
