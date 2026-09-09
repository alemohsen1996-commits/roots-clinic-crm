// سياق المصادقة: يوفر الجلسة + ملف الموظف + الدور لكل التطبيق
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // صف من جدول profiles + كود الدور
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) { setProfile(null); setProfileError(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(code, name_ar)')
        .eq('id', session.user.id)
        .single()

      if (cancelled) return

      if (error) {
        // لا نبتلع الخطأ: بدونه يدخل المستخدم بحالة مكسورة وشاشات فارغة
        console.error('[auth] تعذر جلب ملف الموظف:', error)
        setProfile(null)
        setProfileError(error)
      } else {
        setProfile(data)
        setProfileError(null)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [session, reloadKey])

  const value = {
    session,
    profile,
    loading,
    profileError,
    retryProfile: () => setReloadKey(k => k + 1),
    roleCode: profile?.roles?.code ?? null,
    isManager: ['super_admin', 'sales_manager'].includes(profile?.roles?.code),
    isSuperAdmin: profile?.roles?.code === 'super_admin',
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
