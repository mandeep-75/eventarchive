import { NavLink } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import { NAV_ITEMS } from './navItems'

export default function Sidebar() {
  const { profile, isManager } = useAuth()
  const { getDepartment } = useDepartments()
  if (!profile) return null

  const items = NAV_ITEMS.filter((item) => !item.managerOnly || isManager)
  const department = getDepartment(profile.departmentId)

  return (
    // lg and up only. Below it this is replaced by BottomNav — see the note
    // there — so the two are the same list rendered twice, not two lists.
    <aside className="hidden w-56 shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-white lg:flex">
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-200 p-3">
        <p className="flex items-center gap-2 px-3 text-xs text-gray-500">
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={department?.name ?? 'No department'}>
            {department?.name ?? 'No department'}
          </span>
        </p>
      </div>
    </aside>
  )
}
