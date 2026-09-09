// الهيكل العام للتطبيق — السايدبار تتغير روابطه حسب دور المستخدم
// على الموبايل: زر ☰ يفتح القائمة كطبقة، وتُغلق عند اختيار صفحة
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'

// أيقونات خطّية موحّدة — التعرّف عليها أسرع من قراءة النص
const I = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="10" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></>,
  tasks:     <><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M8 2v4M16 2v4"/></>,
  leads:     <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M17 8h5M19.5 5.5v5"/></>,
  deals:     <><path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M4 12h16"/></>,
  prp:       <><path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/><path d="M9.5 12.5a2.5 2.5 0 0 0 2.5 2.5"/></>,
  payments:  <><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/></>,
  install:   <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  team:      <><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.2 2.9-5.3 6.5-5.3s6.5 2.1 6.5 5.3"/><path d="M17 5.5a3.2 3.2 0 0 1 0 6"/><path d="M18.5 14.5c1.9.7 3 2.2 3 4"/></>,
  reports:   <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  archive:   <><rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5"/><path d="M10 13h4"/></>,
  settings:  <><circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/></>,
}

const Icon = ({ k }) => (
  <svg className="nav-ico" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{I[k]}</svg>
)

const NAV = [
  { section: 'العمل اليومي', items: [
    { to: '/',      label: 'لوحة التحكم', icon: 'dashboard', roles: 'all' },
    { to: '/tasks', label: 'مهامي اليوم',  icon: 'tasks', badge: 'tasks',
      roles: ['super_admin','sales_manager','agent','coordinator'] },
    // المنسقة الآن ترى الليدات (بوردها) لمتابعة مرضاها المحوّلين إليها
    { to: '/leads', label: 'الليدات', icon: 'leads',
      roles: ['super_admin','sales_manager','agent','coordinator'] },
    { to: '/deals', label: 'الديلات', icon: 'deals',
      roles: ['super_admin','sales_manager','agent','coordinator','accountant'] },
    { to: '/prp',   label: 'قسم البلازما', icon: 'prp',
      roles: ['super_admin','sales_manager','coordinator','prp_officer'] },
  ]},
  { section: 'المالية', items: [
    { to: '/payments', label: 'التحصيلات', icon: 'payments',
      roles: ['super_admin','sales_manager','coordinator','accountant'] },
    { to: '/installments', label: 'الأقساط والمتأخرات', icon: 'install',
      roles: ['super_admin','sales_manager','accountant'] },
  ]},
  { section: 'الإدارة', items: [
    { to: '/team',     label: 'الموظفون',      icon: 'team',     roles: ['super_admin'] },
    { to: '/reports',  label: 'التقارير',       icon: 'reports',  roles: ['super_admin','sales_manager'] },
    { to: '/archive',  label: 'أرشيف الشهور',   icon: 'archive',  roles: ['super_admin','sales_manager'] },
    { to: '/settings', label: 'إعدادات النظام', icon: 'settings', roles: ['super_admin'] },
  ]},
]

export default function Shell() {
  const { profile, roleCode, signOut } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  const [dueTasks, setDueTasks] = useState(0)
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

  // عدّاد المتابعات المستحقة — يظهر بجوار «مهامي اليوم»
  const loadDue = useCallback(async () => {
    if (!profile?.id) return
    const end = new Date(); end.setHours(23, 59, 59, 999)
    const { count } = await supabase.from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('assigned_to', profile.id)
      .lte('due_at', end.toISOString())
    setDueTasks(count ?? 0)
  }, [profile?.id])

  useEffect(() => {
    loadDue()
    const t = setInterval(loadDue, 120000)   // تحديث كل دقيقتين
    return () => clearInterval(t)
  }, [loadDue, location.pathname])

  return (
    <div className="shell">
      {/* شريط علوي — يظهر على الموبايل فقط */}
      <header className="topbar">
        <button className="topbar-btn" onClick={() => setNavOpen(true)} aria-label="فتح القائمة">
          ☰
        </button>
        <div className="topbar-brand">Roots Clinic · CRM</div>
        {dueTasks > 0 && <span className="topbar-badge">{dueTasks}</span>}
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

        <nav className="nav-scroll">
          {NAV.map(group => {
            const visible = group.items.filter(i => canSee(i.roles))
            if (!visible.length) return null
            return (
              <div key={group.section} className="nav-group">
                <div className="nav-section">{group.section}</div>
                {visible.map(i => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'}
                    className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                    <Icon k={i.icon} />
                    <span className="nav-text">{i.label}</span>
                    {i.badge === 'tasks' && dueTasks > 0 && (
                      <span className="nav-badge">{dueTasks.toLocaleString('en-US')}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

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
