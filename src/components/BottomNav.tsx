import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { NAV_ITEMS } from './navItems'

/**
 * The app shell's navigation below `lg`. The sidebar used to be the only one and
 * it is `hidden lg:flex`, which did not mean "a different layout on small
 * screens" — it meant no way off the page you landed on: a phone could open the
 * dashboard and never reach Events or Setup.
 *
 * It is at the bottom rather than the top because the top already has the navbar,
 * and a teacher's thumb reaches the bottom of a phone without the hand moving.
 */
export default function BottomNav() {
  const { profile, isManager } = useAuth()
  if (!profile) return null

  const items = NAV_ITEMS.filter((item) => !item.managerOnly || isManager)

  return (
    // Fixed rather than in the flex row so it does not shorten the scrolling
    // <main>; Layout pads the bottom of <main> by the same height instead.
    // The safe-area inset keeps it clear of the home indicator on a notched
    // phone, which otherwise sits on top of the labels.
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="flex">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                // py-2 on a 20px icon lands the row at 44px, which is the
                // smallest target a fingertip reliably hits.
                `flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition ${
                  isActive ? 'text-indigo-600' : 'text-gray-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={`h-5 w-5 ${isActive ? 'text-indigo-600' : ''}`} />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
