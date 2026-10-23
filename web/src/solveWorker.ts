/**
 * Solver worker: tables are fetched or built and the cube solved off the main thread, so the
 * page keeps painting its progress while a shared link or the Go button is being worked on.
 */
import type { Face } from "./api.js";
import { prepare, solveNet, type SolveMode, type SolveResult } from "./solveAny.js";
import { setLang, type Lang } from "./i18n.js";

export type WorkerRequest = { id: number; type: "solve"; size: number; faces: Record<Face, string[]>; mode: SolveMode; lang: Lang } | { id: number; type: "warm"; size: number };
export type WorkerReply = { id: number; type: "progress"; fraction: number } | { id: number; type: "result"; result: SolveResult } | { id: number; type: "ready" } | { id: number; type: "error"; message: string };

const post = (msg: WorkerReply) => (self as unknown as { postMessage(m: WorkerReply): void }).postMessage(msg);

self.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  void (async () => {
    try {
      await prepare(req.size, (fraction) => post({ id: req.id, type: "progress", fraction }));
      if (req.type === "warm") post({ id: req.id, type: "ready" });
      else {
        setLang(req.lang);
        post({ id: req.id, type: "result", result: solveNet(req.size, req.faces, req.mode) });
      }
    } catch (err) {
      post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  })();
});
