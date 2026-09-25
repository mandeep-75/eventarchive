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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-200 bg-white/90 px-4 backdrop-blur lg:px-6">
      <Link to="/" className="flex items-center gap-2 font-semibold text-gray-900">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <School className="h-4 w-4" />
        </span>
        College Event Hub
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-right">
          <div>
            <p className="text-sm font-medium leading-tight text-gray-900">
              {profile?.name ?? user?.email}
            </p>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
          {/* Email and password accounts have no avatar to show. */}
          <UserCircle2 className="h-8 w-8 text-gray-400" />
        </div>
        <button
          onClick={handleLogout}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
          title="Log out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}