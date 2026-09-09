// الهيكل العام للتطبيق — السايدبار تتغير روابطه حسب دور المستخدم
// على الموبايل: زر ☰ يفتح القائمة كطبقة، وتُغلق عند اختيار صفحة
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const NAV = [
  { section: 'العمل اليومي', items: [
    { to: '/',        label: 'لوحة التحكم',  roles: 'all' },
    { to: '/tasks',   label: 'مهامي اليوم',   roles: ['super_admin','sales_manager','agent','coordinator'] },
    // المنسقة الآن ترى الليدات (بوردها) لمتابعة مرضاها المحوّلين إليها
    { to: '/leads',   label: 'الليدات',       roles: ['super_admin','sales_manager','agent','coordinator'] },
    { to: '/deals',   label: 'الديلات',       roles: ['super_admin','sales_manager','agent','coordinator','accountant'] },
    { to: '/prp',     label: 'قسم البلازما',  roles: ['super_admin','sales_manager','coordinator','prp_officer'] },
  ]},
  { section: 'المالية', items: [
    { to: '/payments',     label: 'التحصيلات',      roles: ['super_admin','sales_manager','coordinator','accountant'] },
    { to: '/installments', label: 'الأقساط والمتأخرات', roles: ['super_admin','sales_manager','accountant'] },
  ]},
  { section: 'الإدارة', items: [
    { to: '/team',     label: 'الموظفون',        roles: ['super_admin'] },
    { to: '/reports',  label: 'التقارير',         roles: ['super_admin','sales_manager'] },
    { to: '/archive',  label: 'أرشيف الشهور',     roles: ['super_admin','sales_manager'] },
    { to: '/settings', label: 'إعدادات النظام',   roles: ['super_admin'] },
  ]},
]

export default function Shell() {
  const { profile, roleCode, signOut } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  const canSee = (roles) => roles === 'all' || roles.includes(roleCode)

  // إغلاق القائمة عند الانتقال لصفحة أخرى
  useEffect(() => { setNavOpen(false) }, [location.pathname])

  // منع تمرير الخلفية أثناء فتح القائمة
  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [navOpen])

  // الإغلاق بمفتاح Esc
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="shell">
      {/* شريط علوي — يظهر على الموبايل فقط */}
      <header className="topbar">
        <button className="topbar-btn" onClick={() => setNavOpen(true)} aria-label="فتح القائمة">
          ☰
        </button>
        <div className="topbar-brand">Roots Clinic · CRM</div>
      </header>

      {/* طبقة تعتيم خلف القائمة */}
      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}

      <aside className={'sidebar' + (navOpen ? ' open' : '')}>
        <div className="sidebar-top">
          <div className="brand">Roots Clinic <span>·</span> CRM</div>
          <button className="sidebar-close" onClick={() => setNavOpen(false)} aria-label="إغلاق القائمة">
            ✕
          </button>
        </div>

        {NAV.map(group => {
          const visible = group.items.filter(i => canSee(i.roles))
          if (!visible.length) return null
          return (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {visible.map(i => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'}
                  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                  {i.label}
                </NavLink>
              ))}
            </div>
          )
        })}

        <div className="foot">
          <div className="name">{profile?.full_name}</div>
          <div className="role">{profile?.roles?.name_ar}</div>
          <button onClick={signOut}>تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main"><Outlet /></main>
    </div>
  )
}
