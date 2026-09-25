// مكالمات السنترال (Azeer) لليد واحد — تظهر في تبويب «السجل» في LeadDrawer
// التسجيل الصوتي بيتشغّل مباشرة من سيرفر Azeer (مش بيتحمّل غير لما تدوس ▶)
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'

const REC_BASE = 'https://voice.mottasl.com/monitor/259921bba7e3cb16/'
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function LeadCalls({ leadId }) {
  const [calls, setCalls] = useState(null)

  useEffect(() => {
    if (!leadId) return
    let alive = true
    setCalls(null)
    supabase.from('calls')
      .select('id, called_at, direction, duration_seconds, answered, extension, recording_path, agent:profiles!calls_user_id_fkey(full_name)')
      .eq('lead_id', leadId)
      .order('called_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (alive) setCalls(data || []) })
    return () => { alive = false }
  }, [leadId])

  if (!calls || calls.length === 0) return null
  const answered = calls.filter(c => c.answered).length

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 8 }}>
        📞 مكالمات السنترال — {calls.length} مكالمة، اتردّ على {answered}
      </div>
      <div className="timeline">
        {calls.map(c => (
          <div className="timeline-item" key={c.id}>
            <div className="timeline-meta">
              <b>{c.direction === 'in' ? 'مكالمة واردة' : 'مكالمة صادرة'}</b>
              <span>{c.agent?.full_name ?? `Ext ${c.extension}`}</span>
              <span>{fmtDateTime(c.called_at)}</span>
            </div>
            <div className="timeline-body"
              style={{ color: c.answered ? 'var(--ok)' : 'var(--danger)', fontWeight: 600 }}>
              {c.answered ? `اتردّ — ${fmtDur(c.duration_seconds)}` : 'مردّش'}
            </div>
            {c.answered && c.recording_path && (
              <audio controls preload="none" src={REC_BASE + c.recording_path}
                style={{ width: '100%', height: 34, marginTop: 6 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
