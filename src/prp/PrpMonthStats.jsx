// أرقام البلازما لشهر معيّن — تُستخدم في صفحة البلازما والداشبورد
// userId: أرقام موظف واحد (جلسات عملها / غياب سجّله / متابعات عملها)
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import useT from '../i18n/useT'

export function usePrpMonthStats(month, userId = null, refreshKey = 0) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    if (!month) { setStats(null); setLoading(false); return }   // مش مطلوب للمستخدم ده
    setLoading(true)
    supabase.rpc('prp_month_stats', { p_month: month, p_user: userId })
      .then(({ data, error }) => {
        if (error) console.error(error)
        if (alive) { setStats(data ?? null); setLoading(false) }
      })
    return () => { alive = false }
  }, [month, userId, refreshKey])
  return { stats, loading }
}

// شهور آخر سنة (YYYY-MM-01) بتوقيت الرياض — الأحدث الأول
export function lastMonths(count = 12) {
  const [y, m] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }).split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    return d.toISOString().slice(0, 10)
  })
}

export default function PrpMonthStats({ stats, loading, personal = false }) {
  const { t } = useT()
  const s = stats ?? {}
  const att = s.attendance_pct
  const attTone = att == null ? 'muted' : att >= 85 ? 'ok' : att >= 70 ? 'warn' : 'danger'
  const cards = [
    { label: personal ? t('prpStats.sessionsMine') : t('prpStats.sessionsDone'), value: fmtNum(s.sessions_done),
      sub: personal ? t('prpStats.thisMonth') : t('prpStats.ofPlanned', { n: fmtNum(s.sessions_planned) }), tone: 'ok' },
    { label: t('prpStats.attendance'), value: att == null ? '—' : `${att}%`,
      sub: t('prpStats.missedVsDone', { missed: fmtNum(s.sessions_missed), done: fmtNum(s.sessions_done) }), tone: attTone },
    ...(personal ? [] : [
      { label: t('prpStats.pkgsCompleted'), value: fmtNum(s.pkgs_completed),
        sub: t('prpStats.pkgsOpened', { n: fmtNum(s.pkgs_opened) }), tone: 'primary' },
      { label: t('prpStats.pkgsDropped'), value: fmtNum(s.pkgs_dropped),
        sub: t('prpStats.droppedHint'), tone: s.pkgs_dropped > 0 ? 'danger' : 'muted' },
    ]),
    { label: t('prpStats.returned'), value: fmtNum(s.returned),
      sub: t('prpStats.ofFollowups', { n: fmtNum(s.followups) }), tone: 'warn' },
  ]
  return (
    <div className="deals-kpis" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
      {cards.map(c => (
        <div key={c.label} className="deals-kpi static">
          <span className="deals-kpi-head">
            <span>{c.label}</span>
            <span className={'deals-dot tone-' + c.tone} />
          </span>
          <span className={'deals-kpi-value tone-' + c.tone}>{stats ? c.value : '—'}</span>
          <span className="deals-kpi-sub">{stats ? c.sub : ' '}</span>
        </div>
      ))}
    </div>
  )
}
