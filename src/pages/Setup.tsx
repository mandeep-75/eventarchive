import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  BadgeCheck,
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  ShieldAlert,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { createTeacherAccount } from '../supabase/auth'
import {
  addDepartment,
  deleteDepartment,
  subscribeUsers,
  updateUser,
} from '../supabase/data'
import { useAuth } from '../context/AuthContext'
import { useDepartments } from '../hooks/useDepartments'
import type { UserProfile } from '../types'

const PASSWORD_RULE = 'At least 6 characters'

export default function Setup() {
  const { profile, isManager } = useAuth()
  const { departments } = useDepartments()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [usersLoaded, setUsersLoaded] = useState(false)
  const [newDept, setNewDept] = useState('')
  const [addingDept, setAddingDept] = useState(false)
  const [error, setError] = useState('')
  // Which department rows are open. A Set rather than a single id so any number
  // can be open at once — a manager comparing two departments should not have to
  // close one to see the other.
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set())
  // The whole section collapses from its heading, so a manager who is only here
  // for teachers can fold the department list away. One toggle covers both the
  // list and the add form — there is no separate button to learn.
  const [showDepartments, setShowDepartments] = useState(false)

  function toggleDepartment(id: string) {
    setExpandedDepts((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (!isManager) return
    return subscribeUsers(
      (rows) => {
        setUsers(rows)
        setUsersLoaded(true)
      },
      // Without this a failed fetch leaves the teacher list empty with no
      // explanation, and a teacher could be created against a stale department
      // list. Surface it like every other failure on this page.
      (message) => setError(message),
    )
  }, [isManager])

  const existingNames = useMemo(
    () => new Set(departments.map((d) => d.name.toLowerCase())),
    [departments],
  )

  const usersByDepartment = useMemo(() => {
    const map = new Map<string, UserProfile[]>()
    for (const user of users) {
      const key = user.departmentId ?? '__none__'
      const list = map.get(key) ?? []
      list.push(user)
      map.set(key, list)
    }
    return map
  }, [users])

  if (!isManager) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
          <ShieldAlert className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-bold text-gray-900">Setup is manager-only</h1>
        <p className="mt-2 text-sm text-gray-500">
          Ask a manager to add you to a department or provision your login.
        </p>
      </div>
    )
  }

  async function handleAddDepartment(e: FormEvent) {
    e.preventDefault()
    // A double-tap would otherwise fire two inserts; the second is refused by
    // the unique constraint, but the error would be shown for a department that
    // was in fact created.
    if (addingDept) return
    const name = newDept.trim()
    if (!name) return
    if (existingNames.has(name.toLowerCase())) {
      setError('That department already exists')
      return
    }
    try {
      setAddingDept(true)
      await addDepartment(name)
      setNewDept('')
      setError('')
    } catch (err) {
      // Without this the rejection is unhandled: the dialog looks like nothing
      // happened and the duplicate name is never explained. The client-side
      // check above only sees the departments it has loaded, so a row added
      // from another tab still lands here on the unique constraint.
      setError(err instanceof Error ? err.message : 'Could not add the department')
    } finally {
      setAddingDept(false)
    }
  }

  async function handleDeleteDepartment(id: string, name: string) {
    const assigned = users.filter((u) => u.departmentId === id).length
    const warning = assigned
      ? `\n\n${assigned} teacher(s) are assigned to it and will be left with no department.`
      : ''
    if (!confirm(`Delete "${name}"?${warning}`)) return
    try {
      await deleteDepartment(id)
      setError('')
    } catch (err) {
      // The delete is refused outright while any event still files under the
      // department (events.department_id is a plain FK with no ON DELETE), and
      // an event's department cannot be rewritten afterwards — the
      // events_pin_immutable trigger pins it at creation. So the row is kept
      // rather than orphaned, and the refusal is the correct behaviour to show.
      setError(err instanceof Error ? err.message : 'Could not delete the department')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-sm text-gray-500">
          Manage departments and teacher logins. Every teacher can see all events but can
          only edit the ones filed under their own department.
        </p>
      </div>

      {/* Kept out of the collapsible Departments body: a failed teacher move
          comes from the always-visible list, so its error would otherwise sit
          hidden behind a closed section. */}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <CreateTeacher departments={departments} />

      <section className="space-y-3">
        <h2 className="font-semibold text-gray-900">Teachers</h2>
        {!usersLoaded ? (
          <p className="text-sm text-gray-400">Loading teachers…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400">No teacher accounts yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                  <Users className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 font-medium text-gray-900">
                    <span className="truncate">{u.name}</span>
                    {u.id === profile?.id && (
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        you
                      </span>
                    )}
                    {u.isManager && (
                      <span
                        title="Manages departments and teacher accounts"
                        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700"
                      >
                        <BadgeCheck className="h-3 w-3" /> manager
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">{u.email}</p>
                </div>
                {/* A teacher's department can be changed here; a manager's is not
                    editable, because a manager has no department of their own to
                    be moved out of. */}
                {u.isManager ? (
                  <span className="w-full shrink-0 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-500 sm:w-auto">
                    {departments.find((d) => d.id === u.departmentId)?.name ?? 'No department'}
                  </span>
                ) : (
                  /* Full width below sm: sharing a line with the name left this
                     select narrower than its longest option on a phone, and a
                     select that clips its own value is not a filter. */
                  <select
                    value={u.departmentId ?? ''}
                    // A rejection here would otherwise be unhandled and the select
                    // would keep showing a move that never happened.
                    onChange={(e) => {
                      const next = e.target.value || null
                      updateUser(u.id, { departmentId: next }).catch((err) => {
                        setError(
                          err instanceof Error ? err.message : 'Could not move the teacher',
                        )
                      })
                    }}
                    aria-label={`Department for ${u.name}`}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:w-auto sm:pointer-fine:py-1.5 sm:pointer-fine:text-xs"
                  >
                    <option value="">No department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        {/* One toggle for the whole section: it opens to reveal both the list
            and the add form, so there is no separate button to learn. */}
        <h2 className="font-semibold text-gray-900">
          <button
            type="button"
            onClick={() => setShowDepartments((v) => !v)}
            aria-expanded={showDepartments}
            aria-controls="departments-body"
            className="-ml-1 flex items-center gap-1.5 rounded-lg px-1 py-1 transition hover:bg-gray-50"
          >
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
                showDepartments ? '' : '-rotate-90'
              }`}
            />
            Departments
          </button>
        </h2>
        {/* The section is collapsed by default, so on a fresh archive this hint
            is the only thing visible above the fold — without it the add form
            (and the way to reach it) sits behind a closed heading and a manager
            with zero departments has no obvious next step. */}
        {departments.length === 0 && (
          <p className="text-sm text-gray-400">
            No departments yet. Open this section to add the first one.
          </p>
        )}
        {/* Kept in the tree and toggled with the `hidden` attribute so the
            heading's aria-controls always points at a real element. */}
        <div id="departments-body" className="space-y-3" hidden={!showDepartments}>
        {/* Stacks below sm. A fixed w-64 input next to the button is ~344px
            wide, which is more than a 360px phone has left after the page
            gutter, so the row used to overflow the screen. */}
        <form
          onSubmit={handleAddDepartment}
          className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-center"
        >
          <input
            value={newDept}
            onChange={(e) => {
              setNewDept(e.target.value)
              setError('')
            }}
            placeholder="New department name"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:w-64 sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
          />
          <button
            type="submit"
            disabled={addingDept}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 sm:pointer-fine:py-2"
          >
            <Plus className="h-4 w-4" /> {addingDept ? 'Adding…' : 'Add'}
          </button>
        </form>
        {departments.length === 0 ? (
          <p className="text-sm text-gray-400">
            Add one to assign teachers.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {departments.map((d) => {
              const members = usersByDepartment.get(d.id) ?? []
              const expanded = expandedDepts.has(d.id)
              const panelId = `dept-panel-${d.id}`
              return (
                <li key={d.id}>
                  <div className="flex items-center gap-2 pr-4">
                    {/* The whole row is the toggle, not just the chevron: a
                        16px icon is not a touch target. */}
                    <button
                      type="button"
                      onClick={() => toggleDepartment(d.id)}
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${
                          expanded ? '' : '-rotate-90'
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block font-medium break-words text-gray-900">
                          {d.name}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {members.length} teacher(s)
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDepartment(d.id, d.name)}
                      className="-mr-1.5 shrink-0 rounded p-3 text-gray-400 transition hover:bg-red-50 hover:text-red-600 sm:pointer-fine:p-1.5"
                      title={`Delete ${d.name}`}
                      aria-label={`Delete ${d.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {/* Kept in the tree and hidden with the attribute rather than
                      conditionally rendered: the row button's aria-controls
                      names this panel, and an attribute is the only way that id
                      still resolves while the row is collapsed. */}
                  <div
                    id={panelId}
                    className="border-t border-gray-100 bg-gray-50/60 px-4 py-3"
                    hidden={!expanded}
                  >
                    {members.length === 0 ? (
                      <p className="text-sm text-gray-400">
                        No teachers assigned to this department.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {members.map((m) => (
                          <li key={m.id} className="flex min-w-0 items-center gap-2 text-sm">
                            <Users
                              aria-hidden="true"
                              className="h-3.5 w-3.5 shrink-0 text-gray-400"
                            />
                            <span className="min-w-0 truncate font-medium text-gray-800">
                              {m.name}
                            </span>
                            <span className="min-w-0 truncate text-xs text-gray-500">
                              {m.email}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        </div>
      </section>
    </div>
  )
}

function CreateTeacher({ departments }: { departments: { id: string; name: string }[] }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [departmentId, setDepartmentId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!departmentId) {
      setError('Pick a department for this teacher')
      return
    }
    if (password.length < 6) {
      setError(`Password: ${PASSWORD_RULE.toLowerCase()}`)
      return
    }

    setSubmitting(true)
    try {
      // The edge function creates the login and its profile row together, so a
      // profile can never be orphaned by a half-finished signup.
      await createTeacherAccount({
        name: name.trim(),
        email: email.trim(),
        password,
        departmentId,
      })
      setName('')
      setEmail('')
      setPassword('')
      setDepartmentId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-gray-900">Add a teacher</h2>
      <p className="text-sm text-gray-500">
        Creates the login and files the teacher under a department. Move them later from the
        list below.
      </p>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="t-name" className="mb-1 block text-sm font-medium text-gray-700">
              Full name *
            </label>
            <input
              id="t-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
            />
          </div>
          <div>
            <label htmlFor="t-email" className="mb-1 block text-sm font-medium text-gray-700">
              Email *
            </label>
            <input
              id="t-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
            />
          </div>
          <div>
            <label htmlFor="t-pass" className="mb-1 block text-sm font-medium text-gray-700">
              Password *
            </label>
            <div className="relative">
              <input
                id="t-pass"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-3 pr-11 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:pointer-fine:py-2 sm:pointer-fine:pr-10 sm:pointer-fine:text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-3 text-gray-400 transition hover:text-gray-600 sm:pointer-fine:p-2"
                title={showPassword ? 'Hide password' : 'Show password'}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-400">{PASSWORD_RULE}</p>
          </div>
          <div>
            <label htmlFor="t-dept" className="mb-1 block text-sm font-medium text-gray-700">
              Department *
            </label>
            <select
              id="t-dept"
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 sm:pointer-fine:py-2 sm:pointer-fine:text-sm"
            >
              <option value="">Select department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 sm:w-auto sm:pointer-fine:py-2"
        >
          <UserPlus className="h-4 w-4" />
          {submitting ? 'Creating…' : 'Create teacher'}
        </button>
      </form>
    </section>
  )
}
