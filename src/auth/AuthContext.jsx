// سياق المصادقة: يوفر الجلسة + ملف الموظف + الدور لكل التطبيق
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)   // صف من جدول profiles + كود الدور
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  // معرّف المستخدم الحالي — نعيد الجلب عند تغيّره فقط
  const userIdRef = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session ?? null
      userIdRef.current = s?.user?.id ?? null
      setSession(s)
      if (!s) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const newId = s?.user?.id ?? null

      // تسجيل خروج
      if (!s) {
        userIdRef.current = null
        setSession(null)
        setProfile(null)
        setProfileError(null)
        setLoading(false)
        return
      }

      // تجديد التوكن أو العودة للتبويب: نفس المستخدم
      // تحديث الجلسة هنا كان يعيد جلب الملف ويُفرغ الشاشة،
      // فتُغلق اللوحات وتعود الفلاتر لوضعها الابتدائي
      if (newId && newId === userIdRef.current) {
        if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
          setSession(s)
        }
        return
      }

      // مستخدم مختلف فعلًا → أعد التحميل
      userIdRef.current = newId
      setSession(s)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  // جلب الملف الشخصي — مرتبط بمعرّف المستخدم لا بكائن الجلسة
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*, roles(code, name_ar)')
        .eq('id', userId)
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
  }, [userId, reloadKey])

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
