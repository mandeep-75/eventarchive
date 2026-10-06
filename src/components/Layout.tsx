import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'

export default function Layout() {
  return (
    // h-dvh, not h-screen: 100vh on a phone includes the browser chrome that
    // hides on scroll, so the shell is taller than the visible area and the
    // bottom of <main> is unreachable behind the tab bar. dvh is the viewport the
    // browser is actually showing right now.
    <div className="flex h-dvh flex-col overflow-hidden bg-gray-50">
      <Navbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* pb-20 clears the fixed tab bar on small screens; lg has no bar, so it
            goes back to the normal gutter. */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 pb-20 lg:p-6">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      {/* pointer-events-none so it can never swallow a click meant for the
          content underneath. Only rendered inside the app shell, so it does
          not appear on the login screen.
          Hidden below lg: it is absolutely positioned over the bottom-right
          corner, which is exactly where the tab bar's rightmost item is, and a
          credit is not worth making a nav button harder to hit. */}
      <p className="pointer-events-none fixed bottom-3 right-4 z-10 hidden select-none text-xs text-gray-400 lg:block">
        made by <span className="font-medium text-gray-500">mandeep</span>
      </p>
    </div>
  )
}
