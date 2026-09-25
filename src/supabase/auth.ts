import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './client'

export function onAuthStateChange(callback: (user: User | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
    callback(session?.user ?? null)
  })
  return () => data.subscription.unsubscribe()
}

export async function loginWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
}

export async function logout() {
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(error.message)
}

export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user ?? null
}

export interface CreatedAccount {
  uid: string
  email: string
}

/**
 * Creates a teacher login without disturbing the manager's own session.
 *
 * This calls a Supabase Edge Function rather than `supabase.auth.signUp`,
 * because signUp establishes a session for the new account and would sign the
 * manager straight out of the app. The equivalent shortcut — calling the
 * admin API with a service-role key — is not an option here: that key would
 * have to ship in the browser bundle.
 *
 * The function holds the service-role key, re-checks that the caller is a
 * manager, and creates both the login and its profile row. See
 * supabase/functions/create-teacher/index.ts.
 */
export async function createTeacherAccount(input: {
  email: string
  password: string
  name: string
  departmentId: string
}): Promise<CreatedAccount> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('You must be signed in to create an account.')

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-teacher`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The function verifies this is a manager before using its own key.
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    },
  )

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(detail.error ?? 'Could not create account')
  }

  const data = (await res.json()) as CreatedAccount
  return data
}
