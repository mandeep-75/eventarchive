import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, School } from 'lucide-react'
import { loginWithEmail } from '../supabase/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await loginWithEmail(email, password)

      // ProtectedRoute remembers where a signed-out visitor was headed and
      // passes it through, so a deep link to an event survives the login detour.
      // The search string comes too, so a filtered link (?status=completed and
      // friends) still shows what it was pointed at rather than the unfiltered
      // list. /setup is excluded: a manager who got bounced off it would
      // otherwise be returned there, and a newly added teacher would land on a
      // screen they have no business seeing. Everything else falls back to the
      // events list.
      const from = (location.state as { from?: { pathname: string; search?: string } })?.from
      const target =
        from && from.pathname !== '/setup' && from.pathname !== '/'
          ? from.pathname + (from.search ?? '')
          : '/events'
      navigate(target, { replace: true })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Login failed',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // dvh rather than screen: on a phone 100vh is taller than what is visible
    // once the keyboard is up, which pushes the Sign In button under it.
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <School className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-bold text-gray-900">College Event Hub</h1>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
              placeholder="you@college.edu"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-3 pr-11 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 sm:pointer-fine:py-2 sm:pointer-fine:pr-10 sm:pointer-fine:text-sm"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-3 text-gray-400 transition hover:text-gray-600 sm:pointer-fine:p-2"
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50 sm:pointer-fine:py-2"
          >
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}