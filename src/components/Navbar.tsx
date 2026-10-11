import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LogOut, School, UserCircle2 } from 'lucide-react'
import { logout } from '../supabase/auth'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import { NAV_ITEMS } from './navItems'

export default function Navbar() {
  const { user, profile, isManager } = useAuth()
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()

  // Managers have no department, so their subtitle names the role instead.
  const department = profile && !isManager ? getDepartment(profile.departmentId) : undefined
  const subtitle = profile
    ? isManager
      ? 'Manager'
      : department?.name ?? 'No department'
    : '...'

  // Setup is manager-only; the same single list the bottom bar renders below
  // lg, so the two cannot disagree about what the app contains.
  const navItems = NAV_ITEMS.filter((item) => !item.managerOnly || isManager)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-gray-200/80 bg-white/85 px-4 backdrop-blur-md lg:gap-4 lg:px-6">
      <Link to="/" className="group flex min-w-0 items-center gap-2.5 font-semibold text-gray-900">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm ring-1 ring-inset ring-white/15 transition group-hover:bg-brand-700">
          <School className="h-4 w-4" />
        </span>
        {/* Truncates rather than pushing the controls off the bar if the brand
            ever gets longer. */}
        <span className="truncate tracking-tight">College Event Hub</span>
      </Link>

      {/* Desktop navigation. Below lg it is hidden because the bottom tab bar
          covers the phone and a mid-size screen would otherwise show nav twice. */}
      <nav
        aria-label="Sections"
        className="hidden min-w-0 flex-1 items-center gap-1 px-2 lg:flex"
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2.5 text-right">
          {/* Dropped below sm rather than shrunk: the wordmark, the name, the
              department and the avatar do not fit across 360px, and truncating a
              teacher's own name to "Pri…" to keep a subtitle is a bad trade. The
              department is on every card and on the group heading anyway. */}
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-tight text-gray-900">
              {profile?.name ?? user?.email}
            </p>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
          {/* Email and password accounts have no avatar to show. */}
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500">
            <UserCircle2 className="h-6 w-6" />
          </span>
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