/**
 * Page side of the solver worker. Falls back to solving on the main thread when workers are
 * unavailable or the worker script fails to load (an old cached page, a strict browser).
 */
import type { Face } from "./api.js";
import { prepare, solveNet, type SolveMode, type SolveResult } from "./solveAny.js";
import type { WorkerReply, WorkerRequest } from "./solveWorker.js";

// The build stamps a version onto this literal so a new worker is never paired with an old page.
const WORKER_URL = "./solveWorker.js";

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { onProgress?: (f: number) => void; resolve: (r: SolveResult | null) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(WORKER_URL, { type: "module" });
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") p.onProgress?.(msg.fraction);
    else {
      pending.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg.type === "result" ? msg.result : null);
    }
  };
  worker.onerror = () => {
    // the script did not load or crashed: answer everything in flight on the page instead
    const failed = Array.from(pending.values());
    pending.clear();
    worker?.terminate();
    worker = null;
    for (const p of failed) p.reject(new Error("worker failed"));
  };
  return worker;
}

function send(make: (id: number) => WorkerRequest, onProgress?: (f: number) => void): Promise<SolveResult | null> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { onProgress, resolve, reject });
    w.postMessage(make(id));
  });
}

/** Solve on the worker, or on the page when there is none. Progress covers table loading. */
export async function solveAsync(size: number, faces: Record<Face, string[]>, onProgress?: (f: number) => void, mode: SolveMode = "fast"): Promise<SolveResult> {
  const viaWorker = send((id) => ({ id, type: "solve", size, faces, mode }), onProgress);
  if (viaWorker) {
    try {
      const r = await viaWorker;
      if (r) return r;
    } catch {
      /* fall through to the page */
    }
  }
  await prepare(size, onProgress);
  return solveNet(size, faces, mode);
}

/** Start loading what a size needs, while the user is busy elsewhere. */
export function warmAsync(size: number) {
  const viaWorker = send((id) => ({ id, type: "warm", size }));
  if (viaWorker) viaWorker.catch(() => undefined);
  else void prepare(size).catch(() => undefined);
}
