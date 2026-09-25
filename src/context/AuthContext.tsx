import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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

  useEffect(
    () =>
      onAuthStateChange((authUser) => {
        // Signed out must clear loading here: the profile effect below bails out
        // on a null user, so nothing else would ever stop the route spinner.
        if (!authUser) {
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }
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
