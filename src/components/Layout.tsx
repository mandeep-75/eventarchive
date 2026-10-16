import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    // h-dvh, not h-screen: 100vh on a phone includes the browser chrome that
    // hides on scroll, so the shell is taller than the visible area and the
    // bottom of <main> is unreachable behind the tab bar. dvh is the viewport the
    // browser is actually showing right now.
    <div className="flex h-dvh flex-col overflow-hidden bg-gray-50">
      {/* The desktop navigation lives in the navbar — the sidebar is gone, so a
          teacher only ever sees the one nav, moved to the top on a wide screen
          and to the bottom tab bar below it. */}
      <Navbar />
      {/* pb-20 clears the fixed tab bar on small screens; lg has no bar, so it
          goes back to the normal gutter. */}
      <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-20 lg:p-6">
        <Outlet />
        {/* The tab bar's own padding already grew by the safe-area inset, so the
            inset has to be added below the scrolling content too — otherwise the
            last card sits under the home indicator on a notched phone. */}
        <div aria-hidden="true" className="h-[env(safe-area-inset-bottom)] lg:hidden" />
      </main>
      <BottomNav />
    </div>
  )
}