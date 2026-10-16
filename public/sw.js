// Hand-rolled service worker whose only job is installability. There is
// deliberately no offline mode: the archive is live Supabase data behind RLS,
// and covers and reports are short-lived signed URLs. A cached page or response
// would be stale at best, and one teacher's cached signed media at worst — so
// nothing is ever cached. The worker exists because Chrome and Edge will not
// offer to install without one, and it is kept to a pure network pass-through.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // An earlier version of this worker cached an app shell. Drop every cache so
  // an updated client cannot keep serving that offline copy.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

// Network-only. Responding explicitly keeps the fetch handler real, which is
// the part the installer looks for, while every request still goes to the
// network — no offline fallback, no stale bytes, and nothing shared between
// teachers.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
