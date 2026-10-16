// Hand-rolled service worker: enough for installability and an offline shell,
// without a build plugin. Bump CACHE_VERSION to retire every old cache.
const CACHE_VERSION = 'kcg-hub-v1'
const CACHE = `app-shell-${CACHE_VERSION}`
const SHELL = '/'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Everything the browser asks of another origin is left alone. That is
  // dominated by Supabase — auth, REST and short-lived signed media URLs — and
  // a cached signed URL would be two bugs at once: stale data, and one teacher
  // served another's photo. The app makes no other cross-origin requests.
  if (url.origin !== self.location.origin) return

  // The worker and the manifest must always be revalidated, or a new deploy
  // could never install: a cache-first hit would keep serving the old file.
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return

  // Navigations are network-first, so a signed-in teacher always gets the
  // current index.html; the cached shell is only the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error())),
    )
    return
  }

  // Vite fingerprints built assets, so a hit is always the right bytes and a
  // miss is a first visit. Cache-first keeps repeat loads off the network.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
