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
 * rejects outright. The sidebar and the dashboard both watch departments, so
 * without this the page throws on mount.
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
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        onError?.(`Lost the live connection to ${table}.`)
      }
    })

  let cancelled = false

  async function refetch() {
    const { data, error } = await supabase.from(table).select('*')
    if (cancelled) return
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
): Unsubscribe {
  const channel = supabase
    .channel(uniqueTopic(`profile`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
      () => {
        void refetch()
      },
    )
    .subscribe()

  let cancelled = false

  async function refetch() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle()
    if (cancelled) return
    onData(error || !data ? null : toProfile(data))
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

export async function createEvent(data: Omit<CollegeEvent, 'createdAt' | 'updatedAt'>) {
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

export async function getEvent(id: string) {
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
