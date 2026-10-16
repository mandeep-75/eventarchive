import { useEffect, useState, useSyncExternalStore } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { clearInstallPrompt, getInstallPrompt, subscribeInstall } from '../pwa'

const DISMISS_KEY = 'kcg-install-dismissed-at'
// Long enough to stop nagging, short enough that a "not now" is not permanent —
// a teacher who declines on a phone they did not want it on gets asked again.
const SUPPRESS_MS = 14 * 24 * 60 * 60 * 1000

// Chrome and Edge hand over a prompt; iOS Safari never fires the event, and the
// only route there is the Share sheet, so those users get steps rather than a
// button whose tap would do nothing.
function isIos() {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac, so touch points are what give it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    return at > 0 && Date.now() - at < SUPPRESS_MS
  } catch {
    // Storage throws in some private modes. Treating that as "not dismissed"
    // shows the prompt anyway rather than crashing on the read.
    return false
  }
}

export default function InstallPrompt() {
  const prompt = useSyncExternalStore(subscribeInstall, getInstallPrompt)
  const [visible, setVisible] = useState(false)
  const [steps, setSteps] = useState(false)

  // Nothing is gained by covering the page the instant it renders, so the
  // prompt waits. It stays out of the way entirely once the app is installed,
  // and after a recent "not now".
  useEffect(() => {
    if (visible) return
    if (isStandalone() || dismissedRecently()) return
    if (!prompt && !isIos()) return
    const timer = window.setTimeout(() => setVisible(true), 3500)
    return () => window.clearTimeout(timer)
  }, [prompt, visible])

  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  function dismiss() {
    setVisible(false)
    // Reset so reopening shows the Install button again rather than the iOS
    // steps left over from a previous dismissal.
    setSteps(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Without storage the prompt simply comes back next time.
    }
  }

  async function handlePrimary() {
    // iOS has no prompt to fire, so the primary action is the instructions.
    if (!prompt) {
      setSteps(true)
      return
    }
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice.catch(() => null)
      clearInstallPrompt()
      if (choice?.outcome === 'accepted') setVisible(false)
      else dismiss()
    } catch {
      // The event is single-use, so a refusal cannot be retried. The manual
      // steps are the iOS Share sheet, which no other platform has; anywhere
      // else a refused prompt simply closes.
      clearInstallPrompt()
      if (isIos()) setSteps(true)
      else dismiss()
    }
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-title"
      className="fixed inset-0 z-40"
    >
      <div className="absolute inset-0 bg-gray-900/40" onClick={dismiss} aria-hidden="true" />

      {/* Clear of the fixed tab bar on small screens, and of the home indicator
          on a notched phone. */}
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-6">
        <div className="relative rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 sm:pointer-fine:h-8 sm:pointer-fine:w-8"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-start gap-3 pr-6">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Download className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="install-title" className="text-base font-semibold text-gray-900">
                Install KCG Event Hub
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Add it to your home screen to open it full screen.
              </p>
            </div>
          </div>

          {steps && (
            <ol className="mt-4 space-y-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">
              <li className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-600 ring-1 ring-gray-200">
                  1
                </span>
                Tap <Share className="h-4 w-4 text-brand-600" aria-hidden="true" /> in the browser bar.
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-600 ring-1 ring-gray-200">
                  2
                </span>
                Choose <SquarePlus className="h-4 w-4 text-brand-600" aria-hidden="true" />
                <span className="font-medium text-gray-900">Add to Home Screen</span>.
              </li>
            </ol>
          )}

          <div className="mt-4 flex gap-2">
            {!steps && (
              <button
                type="button"
                onClick={dismiss}
                className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 sm:pointer-fine:py-2"
              >
                Not now
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={steps ? dismiss : handlePrimary}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:bg-brand-800 sm:pointer-fine:py-2"
            >
              {steps ? 'Got it' : prompt ? 'Install' : 'How do I install?'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
