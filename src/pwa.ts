// PWA plumbing that has to run once, at module load, rather than inside a
// component: `beforeinstallprompt` fires early and is never replayed, so a
// listener attached when the prompt component happens to mount can miss it.

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function subscribeInstall(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Stable reference while unchanged, which is what useSyncExternalStore requires.
export function getInstallPrompt() {
  return deferred
}

export function clearInstallPrompt() {
  deferred = null
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // The browser's own mini-infobar is suppressed; the app asks on its own
    // terms instead, and the same event is replayed when the user taps Install.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', clearInstallPrompt)
}

// Registers the service worker in public/sw.js. The worker is network-only —
// it caches nothing, so there is no offline mode to go stale — and exists only
// because Chrome and Edge will not offer to install without one. Kept out of
// dev: a worker in front of Vite's module server would sit between the browser
// and the dev server, and there is nothing to test that a manifest is not
// already covering.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration only costs installability; the app itself is
      // unaffected, so there is nothing to surface.
    })
  }

  // The script is a deferred module, so `load` has normally not fired yet — but
  // if it already has (a late import, a bfcache restore), waiting for it again
  // would mean never registering at all.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
