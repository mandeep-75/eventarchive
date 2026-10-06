import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { onAuthStateChange } from '../supabase/auth'
import { subscribeUser } from '../supabase/data'
import type { UserProfile } from '../types'

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  isManager: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  // Which account the state above currently reflects. Supabase emits an auth
  // event for a token refresh, a page focus and the initial session alike, each
  // handing down a new User object for the same account. Treating those as a
  // sign-in would flip `loading` back on — blanking the route to a spinner
  // mid-session — and re-run the profile effect below, cancelling the live
  // profile subscription and refilling every form keyed on the profile.
  const signedInId = useRef<string | null>(null)

  useEffect(
    () =>
      onAuthStateChange((authUser) => {
        // Signed out must clear loading here: the profile effect below bails out
        // on a null user, so nothing else would ever stop the route spinner.
        if (!authUser) {
          signedInId.current = null
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }
        if (signedInId.current === authUser.id) return
        signedInId.current = authUser.id
        setUser(authUser)
        setLoading(true)
      }),
    [],
  )

  useEffect(() => {
    if (!user) return
    return subscribeUser(user.id, (p) => {
      setProfile(p)
      setLoading(false)
    })
  }, [user])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isManager: profile?.isManager === true,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
