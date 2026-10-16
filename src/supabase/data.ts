import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './client'
import {
  eventInsertRow,
  fromEvent,
  fromProfile,
  toDepartment,
  toEvent,
  toProfile,
} from './mappers'
import type { CollegeEvent, Department, UserProfile } from '../types'

type Unsubscribe = () => void

/**
 * A fresh channel topic per subscription.
 *
 * `supabase.channel(topic)` returns the *existing* channel when that topic is
 * already in use, so two components watching the same table would share one
 * channel and the second `.on()` would run after `.subscribe()`, which the SDK
 * rejects outright. Several views watch departments — the navbar's department
 * subtitle, EventDetails, Events and Setup — so without this the page throws
 * on mount.
 */
let channelSeq = 0
function uniqueTopic(prefix: string) {
  channelSeq += 1
  return `${prefix}-${channelSeq}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Subscribes to a table and re-sends the full matching set on every change.
 *
 * The app's subscriptions all took a "give me the data" callback rather than a
 * delta, so this refetches after each payload. Fetching a handful of rows is
 * cheaper and far easier to reason about than reassembling INSERT/UPDATE/DELETE
 * events in the right order, and it cannot drift out of sync with the filters.
 */
function subscribeTable(
  table: string,
  onData: (rows: Record<string, any>[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  let cancelled = false
  // The SDK rejoins the channel by itself after a drop, and fires `SUBSCRIBED`
  // again when it does — but every change that landed while it was down was
  // never delivered. Refetching on the *second* and later `SUBSCRIBED` is what
  // closes that gap; the first is the initial connect, which already fetches
  // below. Without it a sleeping laptop wakes to a silently stale list, which is
  // the very "connected but never delivers" failure the realtime publication is
  // there to avoid.
  let joined = false
  // Realtime can deliver a short burst, and each payload refetches the whole
  // table. Responses are not guaranteed to arrive in order, so an older snapshot
  // must never overwrite a newer one: the sequence number lets only the last
  // request issued land.
  let seq = 0

  const channel: RealtimeChannel = supabase
    .channel(uniqueTopic(`${table}-changes`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      () => {
        void refetch()
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (joined) {
          // A rejoin means the connection recovered: clear any error banner and
          // refill whatever changed during the gap.
          onError?.('')
          void refetch()
        }
        joined = true
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(`Lost the live connection to ${table}.`)
      }
    })

  async function refetch() {
    const mine = ++seq
    const { data, error } = await supabase.from(table).select('*')
    if (cancelled || mine !== seq) return
    if (error) {
      onError?.(error.message)
      return
    }
    onData(data ?? [])
  }

  void refetch()

  return () => {
    cancelled = true
    void supabase.removeChannel(channel)
  }
}

// ─── Users ────────────────────────────────────────────────────────────────

export function subscribeUser(
  uid: string,
  onData: (user: UserProfile | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  let cancelled = false
  let joined = false
  let seq = 0
  const channel = supabase
    .channel(uniqueTopic(`profile`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
      () => {
        void refetch()
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (joined) {
          onError?.('')
          void refetch()
        }
        joined = true
        return
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.('Lost the live connection to your account.')
      }
    })

  async function refetch() {
    const mine = ++seq
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
    if (cancelled || mine !== seq) return
    // A dropped fetch is not "no profile". Coercing the two together walls a
    // valid account behind the "Account not set up" screen — with sign-out as
    // the only way out — on any network blip. Only a successful read that comes
    // back with no row means the login was never provisioned.
    if (error) {
      onError?.(error.message)
      return
    }
    onData(data ? toProfile(data) : null)
  }

  void refetch()

  return () => {
    cancelled = true
    void supabase.removeChannel(channel)
  }
}

export function subscribeUsers(
  onData: (users: UserProfile[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  return subscribeTable('profiles', (rows) => onData(rows.map(toProfile)), onError)
}

export async function updateUser(uid: string, data: Partial<UserProfile>) {
  const { error } = await supabase
    .from('profiles')
    .update(fromProfile(data))
    .eq('id', uid)
  if (error) throw new Error(error.message)
}

/**
 * Creates the profile that backs a freshly provisioned login.
 *
 * `departmentId` is optional: an account can be created first and put into a
 * department afterwards from the teacher list, which is also how existing
 * accounts are moved.
 */
export async function createUserProfile(
  uid: string,
  data: Pick<UserProfile, 'name' | 'email'> & {
    departmentId?: string | null
    isManager?: boolean
  },
) {
  const { error } = await supabase.from('profiles').insert({
    id: uid,
    name: data.name,
    email: data.email,
    role: 'teacher',
    department_id: data.departmentId ?? null,
    is_manager: data.isManager ?? false,
  })
  if (error) throw new Error(error.message)
}

// ─── Departments ──────────────────────────────────────────────────────────

export function subscribeDepartments(
  onData: (departments: Department[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  return subscribeTable('departments', (rows) => onData(rows.map(toDepartment)), onError)
}

export async function addDepartment(name: string) {
  const { error } = await supabase.from('departments').insert({ name })
  if (error) throw new Error(error.message)
}

export async function deleteDepartment(id: string) {
  const { error } = await supabase.from('departments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Events ───────────────────────────────────────────────────────────────

// coordinatorName is omitted because the database stamps it from the caller's
// own profile; see eventInsertRow.
export async function createEvent(
  data: Omit<CollegeEvent, 'createdAt' | 'updatedAt' | 'coordinatorName'>,
) {
  const { error } = await supabase.from('events').insert(eventInsertRow(data))
  if (error) throw new Error(error.message)
}

export async function updateEvent(id: string, data: Partial<CollegeEvent>) {
  const { error } = await supabase.from('events').update(fromEvent(data)).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Clears the report columns on an event, and nothing else.
 *
 * A manager may remove a report filed under any department, but deleting the
 * object is only half of it: `report` on the row is what makes the event read as
 * completed. `events_update` is department-scoped, so a manager outside the
 * department cannot write the row — and widening it would hand out the Edit
 * button and every other column with it. This calls the manager-only definer
 * function in schema.sql instead.
 */
export async function clearEventReport(id: string) {
  const { error } = await supabase.rpc('clear_event_report', { p_event_id: id })
  if (error) throw new Error(error.message)
}

// Postgres casts the events.id column to uuid and throws a syntax error on
// anything else before any RLS runs — a hand-typed `/events/lol` would surface
// "invalid input syntax for type uuid" instead of a neutral not-found. The id
// is checked here rather than relying on a `where` clause to absorb it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getEvent(id: string) {
  if (!UUID_RE.test(id)) return null
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? toEvent(data) : null
}

export function subscribeEvents(
  onData: (events: CollegeEvent[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  return subscribeTable('events', (rows) => onData(rows.map(toEvent)), onError)
}
