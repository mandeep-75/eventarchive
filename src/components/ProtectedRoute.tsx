import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogOut, UserX } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { logout } from '../supabase/auth'

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
    </div>
  )
}

export default function ProtectedRoute() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Accounts are provisioned manually, so a valid login can exist without a
  // profile. Send them somewhere useful instead of rendering empty pages.
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <UserX className="h-6 w-6" />
          </span>
          <h1 className="text-lg font-bold text-gray-900">Account not set up</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your login exists but you have not been added to a department yet. Ask
            your manager to finish setting up your account.
          </p>
          <button
            onClick={() => logout()}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    )
  }

  return <Outlet />
}
