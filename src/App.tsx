import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Events from './pages/Events'
import EventDetails from './pages/EventDetails'
import CreateEvent from './pages/CreateEvent'
import EditEvent from './pages/EditEvent'
import Setup from './pages/Setup'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="events">
                <Route index element={<Events />} />
                <Route path="create" element={<CreateEvent />} />
                <Route path=":id" element={<EventDetails />} />
                <Route path=":id/edit" element={<EditEvent />} />
              </Route>
              {/* The calendar is a view of Events now, so old links land there. */}
              <Route
                path="calendar"
                element={<Navigate to="/events?view=calendar" replace />}
              />
              <Route path="setup" element={<Setup />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
