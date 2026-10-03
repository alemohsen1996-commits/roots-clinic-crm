// حارس المسارات: يمنع الدخول قبل التفعيل ويوجه حسب الحالة
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import useT from '../i18n/useT'

const Center = ({ children }) => (
  <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 16 }}>
    {children}
  </div>
)

export function RequireAuth({ children }) {
  const { session, profile, loading, profileError, retryProfile, signOut } = useAuth()
  const { t } = useT()

  if (loading) {
    return <Center><span style={{ color: 'var(--ink-soft)' }}>{t('common.loading')}</span></Center>
  }

  if (!session) return <Navigate to="/login" replace />

  // فشل جلب الملف الشخصي — لا نسمح بالدخول بحالة ناقصة
  if (profileError || !profile) {
    return (
      <Center>
        <div className="card" style={{ maxWidth: 440, padding: 28, textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>{t('auth.profileFailedTitle')}</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.8 }}>
            {t('auth.profileFailedBody')}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
            <button className="btn btn-primary" onClick={retryProfile}>{t('common.retry')}</button>
            <button className="btn btn-ghost" onClick={signOut}>{t('common.logout')}</button>
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
          <h2 style={{ marginBottom: 8 }}>{t('auth.pendingTitle')}</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>
            {profile.status === 'suspended' ? t('auth.suspendedBody') : t('auth.pendingBody')}
          </p>
          <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={signOut}>
            {t('common.logout')}
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

// حارس: المالية — المديرين والمحاسب
export function RequireFinance({ children }) {
  const { isManager, roleCode, loading, profile } = useAuth()
  if (loading || !profile) return null
  if (!isManager && roleCode !== 'accountant') return <Navigate to="/" replace />
  return children
}

// حارس: المدير العام فقط (إعدادات النظام)
export function RequireSuperAdmin({ children }) {
  const { isSuperAdmin, loading, profile } = useAuth()
  if (loading || !profile) return null
  if (!isSuperAdmin) return <Navigate to="/" replace />
  return children
}
