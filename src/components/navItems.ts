import { LayoutDashboard, ListTodo, Settings } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  managerOnly?: boolean
}

// Shared by the sidebar (lg and up) and the bottom tab bar (below it) so the two
// cannot disagree about what the app contains. It used to live inside Sidebar,
// which left the small-screen navigation free to be a second, shorter list —
// which is how a phone ends up with no route to /setup at all.
//
// Creating an event is an action, not a destination — it lives on the Dashboard
// and the Events page. The calendar is a view of Events, not a separate section.
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/events', label: 'Events', icon: ListTodo },
  { to: '/setup', label: 'Setup', icon: Settings, managerOnly: true },
]
