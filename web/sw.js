/*
 * Offline copy of the app. The build (scripts/stamp.mjs) fills in VERSION, a hash of every file
 * below, and PRECACHE, the page, its versioned scripts and styles, the icons and every solver
 * table; a new build therefore installs a fresh cache and drops the old one.
 *
 * The page itself is fetched from the network first, so anyone online always gets the latest
 * build, and from the cache only when the network fails or stalls. Everything else is versioned
 * or content-named, so the cached copy is served straight away. /api/* (the AI) is never cached.
 */
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `rcsolver-${VERSION}`;
const PAGE = new URL("./", self.registration.scope).href;
/** How long to wait for the network before showing the cached page on a bad connection. */
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rcsolver-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function page(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), PAGE_TIMEOUT_MS)),
    ]);
    if (fresh.ok && request.url.split(/[?#]/)[0] === PAGE) cache.put(PAGE, fresh.clone());
    return fresh;
  } catch {
    return (await cache.match(PAGE)) ?? Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(page(request));
  else event.respondWith(asset(request));
});
