// Hand-rolled service worker whose only job is installability. There is
// deliberately no offline mode: the archive is live Supabase data behind RLS,
// and covers and reports are short-lived signed URLs. A cached page or response
// would be stale at best, and one teacher's cached signed media at worst — so
// nothing is ever cached. The worker exists because Chrome and Edge will not
// offer to install without one, and it is kept to a pure network pass-through.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
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

// Network-only, and only for same-origin GETs. Responding explicitly keeps the
// fetch handler real, which is the part the installer looks for, while every
// request still goes to the network — no offline fallback, no stale bytes.
//
// Everything else is deliberately left alone. Supabase auth, REST and signed
// media are all cross-origin, and every write is a non-GET; letting those go
// straight to the browser means the worker can never sit in the path of a
// login, a mutation or a refresh, which a blanket `respondWith(fetch(...))`
// would have done for all of them.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return
  event.respondWith(fetch(request))
})
