import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      <Navbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
      {/* pointer-events-none so it can never swallow a click meant for the
          content underneath. Only rendered inside the app shell, so it does
          not appear on the login screen. */}
      <p className="pointer-events-none fixed bottom-3 right-4 z-10 select-none text-xs text-gray-400">
        made by <span className="font-medium text-gray-500">mandeep</span>
      </p>
    </div>
  )
}