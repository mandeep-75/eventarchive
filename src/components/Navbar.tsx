import { Link, useNavigate } from 'react-router-dom'
import { LogOut, School, UserCircle2 } from 'lucide-react'
import { logout } from '../supabase/auth'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'

export default function Navbar() {
  const { user, profile } = useAuth()
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()

  const department = profile ? getDepartment(profile.departmentId) : undefined
  const subtitle = profile
    ? department?.name ?? 'No department'
    : '...'

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white/90 px-4 backdrop-blur lg:px-6">
      <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold text-gray-900">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <School className="h-4 w-4" />
        </span>
        {/* Truncates rather than pushing the controls off the bar if the brand
            ever gets longer. */}
        <span className="truncate">College Event Hub</span>
      </Link>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 text-right">
          {/* Dropped below sm rather than shrunk: the wordmark, the name, the
              department and the avatar do not fit across 360px, and truncating a
              teacher's own name to "Pri…" to keep a subtitle is a bad trade. The
              department is on the dashboard heading and on every card anyway. */}
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-tight text-gray-900">
              {profile?.name ?? user?.email}
            </p>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
          {/* Email and password accounts have no avatar to show. */}
          <UserCircle2 className="h-8 w-8 text-gray-400" />
        </div>
        {/* 40px tall on touch, back to 32px for a mouse. Keyed off the pointer
            rather than a width: a 1024px tablet is still a touchscreen, and
            `lg:` would have shrunk this exactly where it needs to stay big. */}
        <button
          onClick={handleLogout}
          aria-label="Log out"
          className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 sm:pointer-fine:mr-0 sm:pointer-fine:h-8 sm:pointer-fine:w-8"
          title="Log out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}