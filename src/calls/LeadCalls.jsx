// مكالمات السنترال (Azeer) لليد واحد — تظهر في تبويب «السجل» في LeadDrawer
// التسجيل: من الأرشيف الخاص (Storage برابط مؤقت) لو اتنسخ، وإلا من Azeer مباشرة
// (Azeer بيحوّل التسجيل من .wav لـ .mp3 بعد يوم تقريبًا، وبيمسحه بعد 30 يوم)
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDateTime } from '../lib/format'

const REC_BASE = 'https://voice.mottasl.com/monitor/259921bba7e3cb16/'
const AZEER_KEEP_DAYS = 30
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Recording({ call, signedUrl }) {
  const azeerWav = REC_BASE + call.recording_path
  const [src, setSrc] = useState(signedUrl || azeerWav)
  const [broken, setBroken] = useState(false)

  useEffect(() => { setSrc(signedUrl || azeerWav); setBroken(false) }, [signedUrl, azeerWav])

  const onError = () => {
    // من Azeer: جرّب نسخة الـ mp3 قبل ما نستسلم
    if (!signedUrl && src.endsWith('.wav')) setSrc(azeerWav.replace(/\.wav$/, '.mp3'))
    else setBroken(true)
  }

  if (broken) return <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>التسجيل مش متاح</div>
  return (
    <audio controls preload="none" src={src} onError={onError}
      style={{ width: '100%', height: 34, marginTop: 6 }} />
  )
}

export default function LeadCalls({ leadId, onCount }) {
  const [calls, setCalls] = useState(null)
  const [urls, setUrls] = useState({})

  useEffect(() => {
    if (!leadId) return
    let alive = true
    setCalls(null); setUrls({}); onCount?.(null)
    ;(async () => {
      const { data } = await supabase.from('calls')
        .select('id, called_at, direction, duration_seconds, answered, extension, recording_path, recording_stored_path, agent:profiles!calls_user_id_fkey(full_name)')
        .eq('lead_id', leadId)
        .order('called_at', { ascending: false })
        .limit(50)
      if (!alive) return
      const rows = data || []
      setCalls(rows)
      onCount?.(rows.length)
      const paths = rows.map(c => c.recording_stored_path).filter(Boolean)
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('call-recordings').createSignedUrls(paths, 3600)
        if (!alive) return
        const map = {}
        ;(signed || []).forEach(s => { if (s.signedUrl) map[s.path] = s.signedUrl })
        setUrls(map)
      }
    })()
    return () => { alive = false }
  }, [leadId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!calls || calls.length === 0) return null
  const answered = calls.filter(c => c.answered).length
  const azeerCutoff = Date.now() - AZEER_KEEP_DAYS * 864e5

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 10 }}>
        {calls.length} مكالمة — اتردّ على {answered}{calls.length >= 50 ? ' (آخر 50)' : ''}
      </div>
      <div className="timeline">
        {calls.map(c => {
          const signed = c.recording_stored_path ? urls[c.recording_stored_path] : null
          const playable = c.answered && c.recording_path &&
            (c.recording_stored_path || new Date(c.called_at).getTime() > azeerCutoff)
          return (
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
              {playable && (!c.recording_stored_path || signed) && <Recording call={c} signedUrl={signed} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
