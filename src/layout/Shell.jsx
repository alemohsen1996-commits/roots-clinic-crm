// الهيكل العام للتطبيق — السايدبار تتغير روابطه حسب دور المستخدم
// على الموبايل: زر ☰ يفتح القائمة كطبقة، وتُغلق عند اختيار صفحة
import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { THEMES, getLocalTheme, applyTheme } from '../lib/theme'
import { useChatUnread } from '../chat/useChatUnread'
import useT from '../i18n/useT'
import LangToggle from './LangToggle'
import { useNotifications } from '../notifications/useNotifications'
import { connectCrm, disconnectCrm } from '../lib/crmRealtime'
import { BellButton, NotificationPanel, EntityOpener, useNotifTarget } from '../notifications/NotificationBell'

// أيقونات خطّية موحّدة — التعرّف عليها أسرع من قراءة النص
const I = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="10" width="7" height="11" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></>,
  chat:      <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z"/><path d="M8.5 8.5h7M8.5 11.5h4.5"/></>,
  tasks:     <><path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M8 2v4M16 2v4"/></>,
  leads:     <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M17 8h5M19.5 5.5v5"/></>,
  deals:     <><path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M4 12h16"/></>,
  prp:       <><path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/><path d="M9.5 12.5a2.5 2.5 0 0 0 2.5 2.5"/></>,
  appts:     <><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><circle cx="12" cy="14.5" r="3.2"/><path d="M12 13v1.7l1.3.9"/></>,
  payments:  <><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/></>,
  install:   <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
  statements: <><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></>,
  team:      <><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.2 2.9-5.3 6.5-5.3s6.5 2.1 6.5 5.3"/><path d="M17 5.5a3.2 3.2 0 0 1 0 6"/><path d="M18.5 14.5c1.9.7 3 2.2 3 4"/></>,
  reports:   <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  calls:     <><path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/></>,
  archive:   <><rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5"/><path d="M10 13h4"/></>,
  distribute: <><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5 6.5 17M12 11.5l5.5 5.5"/></>,
  settings:  <><circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5v-.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/></>,
}

const Icon = ({ k }) => (
  <svg className="nav-ico" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{I[k]}</svg>
)

// label = مفتاح ترجمة (nav.*)
const NAV = [
  { section: 'daily', items: [
    { to: '/',      label: 'dashboard', icon: 'dashboard', roles: 'all' },
    { to: '/tasks', label: 'tasks',  icon: 'tasks', badge: 'tasks',
      roles: ['super_admin','sales_manager','agent','coordinator'] },
    { to: '/chat', label: 'chat', icon: 'chat', badge: 'chat', roles: 'all' },
    // المنسقة الآن ترى الليدات (بوردها) لمتابعة مرضاها المحوّلين إليها
    { to: '/leads', label: 'leads', icon: 'leads',
      roles: ['super_admin','sales_manager','agent','coordinator'] },
    { to: '/appointments', label: 'appointments', icon: 'appts',
      roles: ['super_admin','sales_manager','agent','coordinator'] },
    { to: '/deals', label: 'deals', icon: 'deals',
      roles: ['super_admin','sales_manager','agent','coordinator','accountant'] },
    { to: '/prp',   label: 'prp', icon: 'prp',
      roles: ['super_admin','sales_manager','coordinator','prp_officer'] },
  ]},
  { section: 'finance', items: [
    { to: '/payments', label: 'payments', icon: 'payments',
      roles: ['super_admin','sales_manager','coordinator','accountant'] },
    { to: '/installments', label: 'installments', icon: 'install',
      roles: ['super_admin','sales_manager','accountant'] },
    { to: '/statements', label: 'statements', icon: 'statements',
      roles: ['super_admin','sales_manager','accountant'] },
  ]},
  { section: 'admin', items: [
    { to: '/team',     label: 'team',       icon: 'team',     roles: ['super_admin'] },
    { to: '/distribute', label: 'distribute', icon: 'distribute', roles: ['super_admin','sales_manager'] },
    { to: '/reports',  label: 'reports',    icon: 'reports',  roles: ['super_admin','sales_manager'] },
    { to: '/calls',    label: 'calls',      icon: 'calls',    roles: ['super_admin','sales_manager'] },
    { to: '/archive',  label: 'archive',    icon: 'archive',  roles: ['super_admin','sales_manager'] },
    { to: '/settings', label: 'settings',   icon: 'settings', roles: ['super_admin','sales_manager'] },
  ]},
]

// شريط التنقل السفلي (موبايل) — أهم 4 أقسام لكل دور + «المزيد» يفتح القائمة الكاملة
// مبني على استخدام الموبايل الفعلي: الليدات ثم المعاينات ثم المهام ثم الشات
const BOTTOM_NAV = {
  coordinator:   ['/leads', '/appointments', '/tasks', '/chat'],
  agent:         ['/leads', '/tasks', '/appointments', '/chat'],
  sales_manager: ['/', '/leads', '/appointments', '/chat'],
  super_admin:   ['/', '/leads', '/appointments', '/chat'],
  accountant:    ['/payments', '/deals', '/installments', '/chat'],
  prp_officer:   ['/prp', '/', '/chat'],
}
const NAV_BY_PATH = Object.fromEntries(NAV.flatMap(g => g.items).map(i => [i.to, i]))

export default function Shell() {
  const { profile, roleCode, signOut } = useAuth()
  const { t, dn } = useT()

  // الثيم: المحفوظ على الجهاز يتطبق فورًا (من index.html)، وبعد تحميل الـ profile
  // لو الموظف مختار ثيم من جهاز تاني نطبقه هنا
  const [theme, setTheme] = useState(getLocalTheme)
  useEffect(() => {
    if (!profile) return
    const saved = profile.theme ?? 'default'
    if (saved !== getLocalTheme()) setTheme(applyTheme(saved))
  }, [profile?.id, profile?.theme])
  const chooseTheme = useCallback(async (key) => {
    setTheme(applyTheme(key))
    const { error } = await supabase.rpc('set_my_theme', { p_theme: key })
    if (error) console.error(error)
  }, [])
  const [navOpen, setNavOpen] = useState(false)
  const [dueTasks, setDueTasks] = useState(0)
  const chatUnread = useChatUnread(profile?.id, ['super_admin', 'sales_manager'].includes(roleCode))

  // التحديث اللحظي للّيدات والدفعات والمعاينات (قنوات الدور + الـ Pool)
  useEffect(() => {
    connectCrm(profile?.id, roleCode)
    return () => disconnectCrm()
  }, [profile?.id, roleCode])
  const location = useLocation()
  const navigate = useNavigate()

  // جرس الإشعارات — هوك واحد للزرارين (السايدبار + الشريط العلوي)
  const notif = useNotifications(profile?.id)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifTarget, setNotifTarget] = useState(null)   // ليد/ديل/باقة مفتوحة من إشعار
  const resolveNotif = useNotifTarget()
  const closeNotif = useCallback(() => setNotifOpen(false), [])
  const toggleNotif = useCallback(() => {
    if (!notifOpen) notif.resetView()   // كل فتح يبدأ من أول صفحة على «الكل»
    setNotifOpen(!notifOpen)
  }, [notifOpen, notif.resetView])
  const pickNotif = useCallback((n) => {
    notif.markRead(n.id)
    setNotifOpen(false)
    setNavOpen(false)
    const tg = resolveNotif(n)
    if (tg) setNotifTarget(tg)
  }, [notif.markRead, resolveNotif])

  // ضغطة على إشعار والأبلكيشن مفتوح → نروح للمحادثة من غير إعادة تحميل
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e) => { if (e.data?.type === 'open-url' && e.data.url) navigate(e.data.url) }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [navigate])

  const canSee = (roles) => roles === 'all' || roles.includes(roleCode)

  const bottomItems = (BOTTOM_NAV[roleCode] ?? ['/', '/chat'])
    .map(p => NAV_BY_PATH[p]).filter(i => i && canSee(i.roles))
  const inChatThread = location.pathname === '/chat' && new URLSearchParams(location.search).get('c')
  const showBottomNav = !!profile && !inChatThread

  // إغلاق القائمة واللوحة عند الانتقال لصفحة أخرى
  useEffect(() => { setNavOpen(false); setNotifOpen(false) }, [location.pathname])

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
    <div className={'shell' + (showBottomNav ? ' has-bnav' : '')}>
      {/* شريط علوي — يظهر على الموبايل فقط */}
      <header className="topbar">
        <button className="topbar-btn" onClick={() => setNavOpen(true)} aria-label={t('common.openMenu')}>
          ☰
        </button>
        <div className="topbar-brand">{t('common.appName')}</div>
        <div className="topbar-end">
          {/* الشارات اللي ليها مكان في الشريط السفلي بتظهر هناك بس */}
          {chatUnread > 0 && !(showBottomNav && bottomItems.some(i => i.to === '/chat')) && (
            <NavLink to="/chat" className="topbar-badge chat" title={t('common.unreadMessages')}>💬 {chatUnread}</NavLink>
          )}
          {dueTasks > 0 && !(showBottomNav && bottomItems.some(i => i.to === '/tasks')) && (
            <span className="topbar-badge">{dueTasks}</span>
          )}
          <BellButton className="on-topbar" unread={notif.unread} open={notifOpen}
            onToggle={toggleNotif} />
        </div>
      </header>

      {/* طبقة تعتيم خلف القائمة */}
      {navOpen && <div className="nav-overlay" onClick={() => setNavOpen(false)} />}

      <aside className={'sidebar' + (navOpen ? ' open' : '')}>
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-text">Roots Clinic <span>·</span> CRM</span>
            <BellButton className="on-sidebar" unread={notif.unread} open={notifOpen}
              onToggle={toggleNotif} />
          </div>
          <button className="sidebar-close" onClick={() => setNavOpen(false)} aria-label={t('common.closeMenu')}>
            ✕
          </button>
        </div>

        <nav className="nav-scroll">
          {NAV.map(group => {
            const visible = group.items.filter(i => canSee(i.roles))
            if (!visible.length) return null
            return (
              <div key={group.section} className="nav-group">
                <div className="nav-section">{t(`nav.sections.${group.section}`)}</div>
                {visible.map(i => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'}
                    className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                    <Icon k={i.icon} />
                    <span className="nav-text">{t(`nav.${i.label}`)}</span>
                    {i.badge === 'tasks' && dueTasks > 0 && (
                      <span className="nav-badge">{dueTasks.toLocaleString('en-US')}</span>
                    )}
                    {i.badge === 'chat' && chatUnread > 0 && (
                      <span className="nav-badge">{chatUnread.toLocaleString('en-US')}</span>
                    )}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="foot">
          <div className="name">{profile?.full_name}</div>
          <div className="role">{dn(profile?.roles)}</div>
          <div className="theme-picker" role="radiogroup" aria-label={t('common.theme')}>
            {THEMES.map(th => (
              <button key={th.key} type="button" title={t(th.label)} aria-label={t(th.label)}
                role="radio" aria-checked={theme === th.key}
                className={theme === th.key ? 'on' : ''}
                onClick={() => chooseTheme(th.key)}>
                {th.swatch.map(c => <i key={c} style={{ background: c }} />)}
              </button>
            ))}
          </div>
          <LangToggle persist />
          <button onClick={signOut}>{t('common.logout')}</button>
        </div>
      </aside>

      <main className="main"><Outlet /></main>

      {showBottomNav && (
        <nav className="bottom-nav" aria-label={t('nav.bottom')}>
          {bottomItems.map(i => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'}
              className={({ isActive }) => 'bnav-item' + (isActive ? ' active' : '')}>
              <span className="bnav-ico">
                <Icon k={i.icon} />
                {i.badge === 'tasks' && dueTasks > 0 && <span className="bnav-badge">{dueTasks > 99 ? '99+' : dueTasks}</span>}
                {i.badge === 'chat' && chatUnread > 0 && <span className="bnav-badge">{chatUnread > 99 ? '99+' : chatUnread}</span>}
              </span>
              <span className="bnav-text">{t(`nav.${i.label}`)}</span>
            </NavLink>
          ))}
          <button type="button" className={'bnav-item' + (navOpen ? ' active' : '')} onClick={() => setNavOpen(true)}>
            <span className="bnav-ico">
              <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </span>
            <span className="bnav-text">{t('nav.more')}</span>
          </button>
        </nav>
      )}

      {notifOpen && (
        <NotificationPanel notif={notif} onClose={closeNotif} onPick={pickNotif} />
      )}
      <EntityOpener target={notifTarget} onClose={() => setNotifTarget(null)} />
    </div>
  )
}
