// المكالمات (للمديرين) — تقرير لكل موظف + استيراد تقرير Azeer (CSV) احتياطي
// ربط الـ Extensions بالموظفين بقى من صفحة فريق العمل؛ هنا تنبيه بس لو فيه أرقام مش مربوطة
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fmtNum } from '../lib/format'

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
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + '٪'

// قراءة الـ CSV كنصوص خام — عشان الصفر في أول الأرقام (05…) ميضيعش
async function parseCsv(file) {
  const text = (await file.text()).replace(/^\uFEFF/, '')
  const wb = XLSX.read(text, { type: 'string', raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' })
}

export default function CallsPage() {
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
        throw new Error('الملف مش بصيغة تقرير Azeer (Calls Recordings ← CSV). أعمدة ناقصة: '
          + (missing.join('، ') || 'كل الأعمدة'))
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>المكالمات</h1>
          <div className="hint">مكالمات السنترال (Azeer) — من {from} إلى {to}</div>
        </div>
        <label className="btn btn-primary" style={{ opacity: busy ? .6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
          {busy ? `جارٍ الاستيراد… ${progress}` : 'استيراد ملف Azeer'}
          <input type="file" accept=".csv" onChange={onFile} hidden />
        </label>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {result && (
        <div className="alert" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
          اتسجّل <b>{fmtNum(result.inserted)}</b> مكالمة جديدة من أصل {fmtNum(result.received)}
          {result.duplicates > 0 && <> — و {fmtNum(result.duplicates)} مستوردة قبل كده اتجاهلت</>}.
          {' '}اتربط {fmtNum(result.leads_linked)} مكالمة بليدز و {fmtNum(result.users_linked)} بموظفين.
        </div>
      )}

      {/* تنبيه صغير لو فيه Extensions مش مربوطة — الربط نفسه من صفحة فريق العمل */}
      {unmapped.length > 0 && (
        <div className="alert" style={{ background: 'var(--warn-soft, #fff7e6)', color: 'var(--ink)', lineHeight: 1.8 }}>
          ⚠️ فيه {unmapped.length} Extension مش مربوطين بموظف، ومكالماتهم بتظهر «غير مربوط»:{' '}
          <b style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
            {unmapped.map(([ext, n]) => `${ext} (${fmtNum(n)})`).join('، ')}
          </b>
          {' — '}<Link to="/team">اربطهم من فريق العمل</Link>
        </div>
      )}

      <div className="card filters-bar">
        <label style={{ fontSize: 13, fontWeight: 600 }}>من</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>إلى</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        <button className="btn btn-ghost" onClick={() => { setFrom(today()); setTo(today()) }}>النهارده</button>
        <button className="btn btn-ghost" onClick={() => { setFrom(monthStart()); setTo(today()) }}>الشهر الجاري</button>
      </div>

      <div className="card">
        {loading ? <div className="empty">جارٍ التحميل…</div>
        : rows.length === 0 ? <div className="empty">مفيش مكالمات في الفترة دي — استورد ملف Azeer من فوق</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>الموظف</th><th>Ext</th><th>الإجمالي</th><th>اتردّ عليها</th><th>مردّش</th>
                  <th>نسبة الرد</th><th>وقت الكلام</th><th>متوسط المكالمة</th><th>أرقام مش في الليدز</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.extension}>
                    <td style={{ fontWeight: 600 }}>
                      {r.full_name || <span style={{ color: 'var(--danger)' }}>غير مربوط</span>}
                    </td>
                    <td style={{ direction: 'ltr', textAlign: 'right' }}>{r.extension}</td>
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
                  <td>الإجمالي</td><td />
                  <td>{fmtNum(totals.total)}</td><td>{fmtNum(totals.answered)}</td><td>{fmtNum(totals.missed)}</td>
                  <td>{pct(totals.answered, totals.total)}</td><td>{fmtDur(totals.talk)}</td>
                  <td>{fmtDur(totals.answered ? Math.round(totals.talk / totals.answered) : 0)}</td>
                  <td>{fmtNum(totals.unlinked)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mapped.length > 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 12, lineHeight: 1.8 }}>
          الـ Extensions المربوطة: {mapped.map(p => `${p.phone_ext} ${p.full_name}`).join('، ')}
        </p>
      )}
    </>
  )
}
