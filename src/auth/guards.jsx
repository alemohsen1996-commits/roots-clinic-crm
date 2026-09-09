// حارس المسارات: يمنع الدخول قبل التفعيل ويوجه حسب الحالة
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

const Center = ({ children }) => (
  <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 16 }}>
    {children}
  </div>
)

export function RequireAuth({ children }) {
  const { session, profile, loading, profileError, retryProfile, signOut } = useAuth()

  if (loading) {
    return <Center><span style={{ color: 'var(--ink-soft)' }}>جارٍ التحميل…</span></Center>
  }

  if (!session) return <Navigate to="/login" replace />

  // فشل جلب الملف الشخصي — لا نسمح بالدخول بحالة ناقصة
  if (profileError || !profile) {
    return (
      <Center>
        <div className="card" style={{ maxWidth: 440, padding: 28, textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>تعذّر تحميل بيانات حسابك</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.8 }}>
            قد يكون الاتصال بالإنترنت منقطعًا، أو حسابك بحاجة لمراجعة من الإدارة.
            جرّب إعادة المحاولة، وإن استمرت المشكلة تواصل مع المدير.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
            <button className="btn btn-primary" onClick={retryProfile}>إعادة المحاولة</button>
            <button className="btn btn-ghost" onClick={signOut}>تسجيل الخروج</button>
          </div>
        </div>
      </Center>
    )
  }

  // مسجل لكن لم يُفعّل بعد
  if (profile.status !== 'active') {
    return (
      <Center>
        <div className="card" style={{ maxWidth: 420, padding: 28, textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>حسابك بانتظار التفعيل</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            {profile.status === 'suspended'
              ? 'هذا الحساب موقوف — تواصل مع الإدارة.'
              : 'تواصل مع المدير ليقوم بتفعيل حسابك وتحديد صلاحياتك.'}
          </p>
          <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={signOut}>
            تسجيل الخروج
          </button>
        </div>
      </Center>
    )
  }

  return children
}

// حارس إضافي: صفحات المديرين فقط
export function RequireManager({ children }) {
  const { isManager, loading, profile } = useAuth()
  if (loading || !profile) return null
  if (!isManager) return <Navigate to="/" replace />
  return children
}
