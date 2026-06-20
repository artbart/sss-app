// Stuff So Sweet — minimal service worker.
// Strategy:
//   - HTML pages: network-first, fall back to cache. (So updates land quickly.)
//   - Static assets (CSS, JS, icons): cache-first. (Fast warm starts.)
//   - Cross-origin (CDN + Supabase API): pass through, no caching. (Always fresh.)
//
// Cache versioning: bump CACHE_VERSION when shipping a breaking change.

const CACHE_VERSION = "sss-app-v6";
const SHELL = [
  "/",
  "/index.html",
  "/auth/callback.html",
  "/stories.html",
  "/story.html",
  "/chapter.html",
  "/settings.html",
  "/quiz.html",
  "/library/",
  "/library/book/where-the-wild-stays/",
  "/library/book/foxlight/",
  "/library/book/the-penthouse-floor/",
  "/library/book/across-the-driveway/",
  "/library/book/after-hours/",
  "/assets/lib.js",
  "/assets/style.css",
  "/site.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL).catch((err) => {
        // Some paths (e.g. settings.html) may not exist yet — ignore.
        console.warn("[sw] precache partial fail (ok):", err);
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Same-origin only — pass external requests straight through
  if (url.origin !== self.location.origin) return;

  // Don't cache API calls or auth flows
  if (url.pathname.startsWith("/auth/")) return;

  // HTML pages: network-first with cache fallback
  const isHtml =
    req.destination === "document" ||
    (req.headers.get("accept") || "").includes("text/html") ||
    url.pathname.endsWith(".html") || url.pathname === "/";

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});
