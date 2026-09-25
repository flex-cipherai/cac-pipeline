import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({})

// Supabase's own session/refresh token stays valid for weeks, so without
// this, reopening the app after a day of inactivity drops you straight
// into the dashboard. This tracks real user activity (shared across tabs
// via localStorage) and forces a fresh login once it's been idle too long.
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000
const LAST_ACTIVITY_KEY = 'sdfm_last_activity'
const ACTIVITY_WRITE_THROTTLE_MS = 5000

function readLastActivity() {
  const stored = localStorage.getItem(LAST_ACTIVITY_KEY)
  return stored ? Number(stored) : Date.now()
}

function writeLastActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const idleSince = Date.now() - readLastActivity()

    if (idleSince > INACTIVITY_LIMIT_MS) {
      supabase.auth.signOut().finally(() => {
        setUser(null)
        setProfile(null)
        setLoading(false)
      })
    } else {
      writeLastActivity()
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchProfile(session.user.id)
        } else {
          setLoading(false)
        }
      })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchProfile(session.user.id)
        } else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // While logged in, track activity and sign out once idle too long —
  // covers the case where the tab is just left open without a reload.
  useEffect(() => {
    if (!user) return

    let lastWrite = 0
    function handleActivity() {
      const now = Date.now()
      if (now - lastWrite > ACTIVITY_WRITE_THROTTLE_MS) {
        lastWrite = now
        writeLastActivity()
      }
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, handleActivity, { passive: true }))

    const interval = setInterval(() => {
      if (Date.now() - readLastActivity() > INACTIVITY_LIMIT_MS) {
        signOut().catch(err => console.error('[Auth] idle sign-out failed:', err))
      }
    }, 60000)

    return () => {
      events.forEach(e => window.removeEventListener(e, handleActivity))
      clearInterval(interval)
    }
  }, [user])

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) {
      // Check if the account has been deactivated
      if (data.is_active === false) {
        await supabase.auth.signOut()
        setUser(null)
        setProfile(null)
        setLoading(false)
        return 'deactivated'
      }

      setProfile(data)

      // Update last sign-in timestamp (fire and forget)
      supabase
        .from('profiles')
        .update({ last_sign_in_at: new Date().toISOString() })
        .eq('id', userId)
        .then()
    }
    setLoading(false)
    return null
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    writeLastActivity()

    // After successful auth, check if the profile is active
    const status = await fetchProfile(data.user.id)
    if (status === 'deactivated') {
      throw new Error('ACCOUNT_DEACTIVATED')
    }

    return data
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setUser(null)
    setProfile(null)
  }

  const value = {
    user,
    profile,
    loading,
    signIn,
    signOut,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
