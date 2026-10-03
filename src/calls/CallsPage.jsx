// المكالمات (للمديرين) — تقرير لكل موظف + استيراد تقرير Azeer (CSV) احتياطي
// ربط الـ Extensions بالموظفين بقى من صفحة فريق العمل؛ هنا تنبيه بس لو فيه أرقام مش مربوطة
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'
import i18n from '../i18n'
import useT from '../i18n/useT'

const CHUNK = 500
const REQUIRED = ['cdr_id', 'date_time', 'from', 'to', 'calltype', 'duration']

const monthStart = () => {
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA')
}
const today = () => new Date().toLocaleDateString('en-CA')

const fmtDur = (s) => {
  s = Number(s) || 0
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
           : `${m}:${String(sec).padStart(2, '0')}`
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '%'

// قراءة الـ CSV كنصوص خام — عشان الصفر في أول الأرقام (05…) ميضيعش
async function parseCsv(file) {
  const text = (await file.text()).replace(/^\uFEFF/, '')
  const wb = XLSX.read(text, { type: 'string', raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' })
}

export default function CallsPage() {
  const { t, isRtl } = useT()
  // الاستيراد
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  // الـ Extensions
  const [profiles, setProfiles] = useState([])
  const [unmapped, setUnmapped] = useState([])

  // التقرير
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  // فلتر الموظف: 'u:<uuid>' لموظف مربوط (يشمل كل Extensions اللي استخدمها قبل كده)،
  // أو 'e:<ext>' لـ Extension مش مربوط. فاضي = كل الموظفين (الجدول المجمّع)
  const [who, setWho] = useState('')

  const loadMapping = useCallback(async () => {
    const [{ data: profs }, { data: calls }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, phone_ext, status').order('full_name'),
      supabase.from('calls').select('extension').is('user_id', null).limit(20000),
    ])
    setProfiles(profs || [])
    const counts = {}
    ;(calls || []).forEach(c => { counts[c.extension] = (counts[c.extension] || 0) + 1 })
    setUnmapped(Object.entries(counts).sort((a, b) => b[1] - a[1]))
  }, [])

  const loadReport = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('calls_report', { p_from: from, p_to: to })
    if (error) setErr(error.message)
    setRows(data || [])
    setLoading(false)
  }, [from, to])

  useEffect(() => { loadMapping() }, [loadMapping])
  useEffect(() => { loadReport() }, [loadReport])

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(''); setResult(null); setBusy(true)
    try {
      const all = await parseCsv(file)
      const missing = REQUIRED.filter(k => !(k in (all[0] || {})))
      if (!all.length || missing.length) {
        throw new Error(t('callsPage.badFile') + ': '
          + (missing.join(', ') || t('callsPage.allColumns')))
      }
      const total = { received: 0, inserted: 0, duplicates: 0, users_linked: 0, leads_linked: 0 }
      for (let i = 0; i < all.length; i += CHUNK) {
        setProgress(`${Math.min(i + CHUNK, all.length)} / ${all.length}`)
        const chunk = all.slice(i, i + CHUNK).map(r => ({
          cdr_id: r.cdr_id, recording_id: r.recording_id, date_time: r.date_time,
          from: r.from, to: r.to, calltype: r.calltype, duration: r.duration,
        }))
        const { data, error } = await supabase.rpc('import_calls', { rows: chunk })
        if (error) throw error
        Object.keys(total).forEach(k => { total[k] += data?.[k] || 0 })
      }
      setResult(total)
      await Promise.all([loadMapping(), loadReport()])
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setBusy(false); setProgress('')
    }
  }

  const totals = useMemo(() => rows.reduce((t, r) => ({
    total: t.total + Number(r.total), answered: t.answered + Number(r.answered),
    missed: t.missed + Number(r.missed), talk: t.talk + Number(r.talk_seconds),
    unlinked: t.unlinked + Number(r.unlinked),
  }), { total: 0, answered: 0, missed: 0, talk: 0, unlinked: 0 }), [rows])

  const mapped = profiles.filter(p => p.phone_ext)
    .sort((a, b) => a.phone_ext.localeCompare(b.phone_ext))

  // خيارات فلتر الموظف: كل اللي ليهم مكالمات في الفترة (مربوطين وغير مربوطين) + المربوطين حاليًا
  const whoOptions = useMemo(() => {
    const opts = new Map()
    rows.forEach(r => {
      if (r.user_id) opts.set('u:' + r.user_id, `${r.full_name} (${r.extension})`)
      else opts.set('e:' + r.extension, `${t('callsPage.unmapped')} — Ext ${r.extension}`)
    })
    mapped.forEach(p => { if (!opts.has('u:' + p.id)) opts.set('u:' + p.id, `${p.full_name} (${p.phone_ext})`) })
    return [...opts].sort((a, b) => a[1].localeCompare(b[1], 'ar'))
  }, [rows, mapped])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.calls')}</h1>
          <div className="hint">{t('callsPage.hint')} — {t('drawer.from')} {from} {t('drawer.to')} {to}</div>
        </div>
        <label className="btn btn-primary" style={{ opacity: busy ? .6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
          {busy ? `${t('callsPage.importing')} ${progress}` : t('callsPage.importFile')}
          <input type="file" accept=".csv" onChange={onFile} hidden />
        </label>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {result && (
        <div className="alert" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
          {t('callsPage.resultInserted', { n: fmtNum(result.inserted), total: fmtNum(result.received) })}
          {result.duplicates > 0 && <> — {t('callsPage.resultDup', { n: fmtNum(result.duplicates) })}</>}.
          {' '}{t('callsPage.resultLinked', { leads: fmtNum(result.leads_linked), users: fmtNum(result.users_linked) })}
        </div>
      )}

      {/* تنبيه صغير لو فيه Extensions مش مربوطة — الربط نفسه من صفحة فريق العمل */}
      {unmapped.length > 0 && (
        <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--ink)', lineHeight: 1.8 }}>
          ⚠️ {t('callsPage.unmappedWarn', { n: unmapped.length })}{' '}
          <b style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
            {unmapped.map(([ext, n]) => `${ext} (${fmtNum(n)})`).join(', ')}
          </b>
          {' — '}<Link to="/team">{t('callsPage.mapFromTeam')}</Link>
        </div>
      )}

      <div className="card filters-bar">
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('drawer.from')}</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>{t('leads.f.to')}</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => { setFrom(today()); setTo(today()) }}>{t('deals.today')}</button>
        <button className="btn btn-ghost" onClick={() => { setFrom(monthStart()); setTo(today()) }}>{t('reports.currentMonth')}</button>
        <select value={who} onChange={e => setWho(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">{t('chat.allEmployees')}</option>
          {whoOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {who && <EmployeeCalls who={who} from={from} to={to}
        label={whoOptions.find(([k]) => k === who)?.[1] ?? ''} onBack={() => setWho('')} />}

      {!who && <div className="card">
        {loading ? <div className="empty">{t('common.loading')}</div>
        : rows.length === 0 ? <div className="empty">{t('callsPage.noCallsPeriod')}</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.employee')}</th><th>Ext</th><th>{t('common.total')}</th><th>{t('callsPage.answered')}</th><th>{t('calls.noAnswer')}</th>
                  <th>{t('callsPage.answerRate')}</th><th>{t('callsPage.talkTime')}</th><th>{t('callsPage.avgCall')}</th><th>{t('callsPage.notInLeads')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.extension} style={{ cursor: 'pointer' }} title={t('callsPage.employeeDetails')}
                    onClick={() => setWho(r.user_id ? 'u:' + r.user_id : 'e:' + r.extension)}>
                    <td style={{ fontWeight: 600 }}>
                      {r.full_name || <span style={{ color: 'var(--danger)' }}>{t('callsPage.unmapped')}</span>}
                    </td>
                    <td className="ltr-cell">{r.extension}</td>
                    <td style={{ fontWeight: 700 }}>{fmtNum(r.total)}</td>
                    <td style={{ color: 'var(--ok)' }}>{fmtNum(r.answered)}</td>
                    <td style={{ color: 'var(--danger)' }}>{fmtNum(r.missed)}</td>
                    <td>{pct(Number(r.answered), Number(r.total))}</td>
                    <td>{fmtDur(r.talk_seconds)}</td>
                    <td>{fmtDur(Number(r.answered) ? Math.round(r.talk_seconds / r.answered) : 0)}</td>
                    <td style={{ color: 'var(--ink-soft)' }}>{fmtNum(r.unlinked)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700, background: 'var(--line-soft)' }}>
                  <td>{t('common.total')}</td><td />
                  <td>{fmtNum(totals.total)}</td><td>{fmtNum(totals.answered)}</td><td>{fmtNum(totals.missed)}</td>
                  <td>{pct(totals.answered, totals.total)}</td><td>{fmtDur(totals.talk)}</td>
                  <td>{fmtDur(totals.answered ? Math.round(totals.talk / totals.answered) : 0)}</td>
                  <td>{fmtNum(totals.unlinked)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>}

      {mapped.length > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 12, lineHeight: 1.8 }}>
          {t('callsPage.mappedExts')}: {mapped.map(p => `${p.phone_ext} ${p.full_name}`).join(', ')}
        </p>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// تفاصيل موظف واحد: ملخّص + توزيع يومي + كل مكالماته في الفترة (بالتسجيلات)
// ─────────────────────────────────────────────────────────────
const REC_BASE = 'https://voice.mottasl.com/monitor/259921bba7e3cb16/'
const AZEER_KEEP_DAYS = 30
const DETAIL_LIMIT = 1000
const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA')
const dayBounds = (from, to) => {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number)
  return [new Date(y1, m1 - 1, d1).toISOString(), new Date(y2, m2 - 1, d2 + 1).toISOString()]
}
const fmtTime = (iso) => new Date(iso).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

function EmployeeCalls({ who, from, to, label, onBack }) {
  const { t, isRtl, lang } = useT()
  const [calls, setCalls] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setCalls(null); setErr('')
    const [start, end] = dayBounds(from, to)
    let q = supabase.from('calls')
      .select('id, called_at, direction, client_phone, extension, duration_seconds, answered, recording_path, recording_stored_path, lead:leads(id, full_name, file_no)')
      .gte('called_at', start).lt('called_at', end)
      .order('called_at', { ascending: false }).limit(DETAIL_LIMIT)
    q = who.startsWith('u:') ? q.eq('user_id', who.slice(2)) : q.eq('extension', who.slice(2)).is('user_id', null)
    q.then(({ data, error }) => {
      if (!alive) return
      if (error) setErr(error.message)
      setCalls(data || [])
    })
    return () => { alive = false }
  }, [who, from, to])

  const stats = useMemo(() => {
    const t = { total: 0, answered: 0, talk: 0, leads: new Set(), unlinked: 0 }
    const byDay = {}
    ;(calls || []).forEach(c => {
      t.total++; if (c.answered) t.answered++; t.talk += c.duration_seconds
      if (c.lead) t.leads.add(c.lead.id); else t.unlinked++
      const d = localDay(c.called_at)
      byDay[d] ??= { total: 0, answered: 0, talk: 0 }
      byDay[d].total++; if (c.answered) byDay[d].answered++; byDay[d].talk += c.duration_seconds
    })
    return { ...t, leads: t.leads.size, days: Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])) }
  }, [calls])

  const card = (l, v, color) => (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{l}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--ink)' }}>{v}</div>
    </div>
  )

  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 17, margin: 0, flex: 1 }}>📞 {label}</h2>
          <button className="btn btn-ghost" onClick={onBack}>{isRtl ? '←' : '→'} {t('statements.allEmployees')}</button>
        </div>
        {err && <div className="alert alert-error">{err}</div>}
        {!calls ? <div className="empty">{t('common.loading')}</div> : (
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {card(t('callsPage.calls'), fmtNum(stats.total))}
            {card(t('callsPage.answered'), fmtNum(stats.answered), 'var(--ok)')}
            {card(t('calls.noAnswer'), fmtNum(stats.total - stats.answered), 'var(--danger)')}
            {card(t('callsPage.answerRate'), pct(stats.answered, stats.total))}
            {card(t('callsPage.talkTime'), fmtDur(stats.talk))}
            {card(t('callsPage.avgCall'), fmtDur(stats.answered ? Math.round(stats.talk / stats.answered) : 0))}
            {card(t('callsPage.distinctLeads'), fmtNum(stats.leads))}
            {card(t('callsPage.notInLeads'), fmtNum(stats.unlinked), 'var(--ink-soft)')}
          </div>
        )}
        {calls?.length >= DETAIL_LIMIT && (
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 10 }}>
            {t('callsPage.limitNote', { n: fmtNum(DETAIL_LIMIT) })}</p>
        )}
      </div>

      {calls?.length > 0 && stats.days.length > 1 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>{t('appts.day')}</th><th>{t('callsPage.calls')}</th><th>{t('callsPage.answered')}</th><th>{t('callsPage.answerRate')}</th><th>{t('callsPage.talkTime')}</th></tr></thead>
              <tbody>
                {stats.days.map(([d, v]) => (
                  <tr key={d}>
                    <td style={{ fontWeight: 600 }}>{new Date(d + 'T12:00').toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'short' })}</td>
                    <td>{fmtNum(v.total)}</td>
                    <td style={{ color: 'var(--ok)' }}>{fmtNum(v.answered)}</td>
                    <td>{pct(v.answered, v.total)}</td>
                    <td>{fmtDur(v.talk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {calls && (
        <div className="card">
          {calls.length === 0 ? <div className="empty">{t('callsPage.noCallsEmployee')}</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>{t('appts.time')}</th><th>{t('dealDrawer.type')}</th><th>{t('lead.client')}</th><th>{t('callsPage.outcome')}</th><th>{t('callsPage.recording')}</th></tr></thead>
                <tbody>
                  {calls.map(c => (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(c.called_at)}</td>
                      <td>{c.direction === 'in' ? t('callsPage.inbound') : t('callsPage.outbound')}</td>
                      <td>
                        {c.lead ? <><b>{c.lead.full_name}</b> <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{c.lead.file_no}</span></>
                          : <span style={{ color: 'var(--ink-soft)' }}>{t('callsPage.notALead')}</span>}
                        <div className="ltr-cell" style={{ fontSize: 12, color: 'var(--ink-soft)' }}>+{c.client_phone}</div>
                      </td>
                      <td style={{ color: c.answered ? 'var(--ok)' : 'var(--danger)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {c.answered ? `${t('calls.answered')} — ${fmtDur(c.duration_seconds)}` : t('calls.noAnswer')}
                      </td>
                      <td style={{ minWidth: 220 }}><PlayRecording call={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// زرار ▶ بيجهّز الرابط وقت الضغط بس (مش مئات روابط مؤقتة مرة واحدة):
// الأرشيف الخاص (رابط مؤقت) ← وإلا Azeer (.wav ثم .mp3) لو المكالمة أحدث من 30 يوم
function PlayRecording({ call }) {
  const { t } = useT()
  const [src, setSrc] = useState(null)
  const [state, setState] = useState('idle')   // idle | loading | ready | none
  const fromAzeer = REC_BASE + (call.recording_path || '')
  const azeerOk = call.recording_path && Date.now() - new Date(call.called_at).getTime() < AZEER_KEEP_DAYS * 864e5

  if (!call.answered || (!call.recording_stored_path && !azeerOk)) {
    return <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>—</span>
  }

  const play = async () => {
    setState('loading')
    if (call.recording_stored_path) {
      const { data } = await supabase.storage.from('call-recordings').createSignedUrl(call.recording_stored_path, 3600)
      if (data?.signedUrl) { setSrc(data.signedUrl); setState('ready'); return }
    }
    if (azeerOk) { setSrc(fromAzeer); setState('ready') } else setState('none')
  }
  const onError = () => {
    if (src?.endsWith('.wav')) setSrc(src.replace(/\.wav$/, '.mp3'))
    else setState('none')
  }

  if (state === 'none') return <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>{t('calls.recordingUnavailable')}</span>
  if (state !== 'ready') {
    return <button className="btn btn-ghost btn-sm" disabled={state === 'loading'} onClick={play}>
      {state === 'loading' ? '…' : `▶ ${t('callsPage.play')}`}</button>
  }
  return <audio controls autoPlay src={src} onError={onError} style={{ width: '100%', height: 32 }} />
}
