// إعدادات توزيع الليدات — النمط + مهلة إعادة التوزيع + نظرة على الفريق
// ملاحظة: التوزيع التلقائي غير مفعّل حاليًا — العمل يتم عبر «توزيع يدوي»
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const MODES = [
  { v: 'round_robin', label: 'Round Robin بسيط', desc: 'توزيع دوري بالتساوي على الجميع' },
  { v: 'weighted',    label: 'موزون', desc: 'الأعلى وزنًا يأخذ نصيبًا أكبر — عدّل الوزن من صفحة الموظفين' },
  { v: 'skill',       label: 'بالمهارة',        desc: 'حسب لغة الليد أولًا ثم الأقل تحميلًا' },
  { v: 'cherry_pick', label: 'التقاط حر',       desc: 'الليد يدخل Pool مشترك وأول من يفتحه يأخذه' },
]

export default function DistributionTab() {
  const [mode, setMode] = useState('')
  const [minutes, setMinutes] = useState('')
  const [team, setTeam] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [{ data: st }, { data: s }, { data: t }] = await Promise.all([
      supabase.from('distribution_state').select('mode').eq('id', 1).maybeSingle(),
      supabase.from('settings').select('value').eq('key', 'reassign_untouched_minutes').maybeSingle(),
      supabase.from('profiles')
        .select('full_name, weight, daily_cap, in_rotation, languages, roles!inner(code)')
        .eq('status', 'active').eq('roles.code', 'agent'),
    ])
    setMode(st?.mode ?? 'weighted')
    setMinutes(String(s?.value ?? 15))
    setTeam(t ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    setBusy(true)
    const [r1, r2] = await Promise.all([
      supabase.from('distribution_state')
        .update({ mode, updated_at: new Date().toISOString() }).eq('id', 1),
      // upsert لا update — لو المفتاح غير موجود فلن يُحفظ شيء بصمت
      supabase.from('settings')
        .upsert({ key: 'reassign_untouched_minutes', value: Number(minutes) }, { onConflict: 'key' }),
    ])
    setBusy(false)
    const error = r1.error || r2.error
    if (error) { setMsg({ ok: false, t: 'تعذر الحفظ — ' + error.message }); return }
    setMsg({ ok: true, t: 'تم حفظ الإعدادات' })
    setTimeout(() => setMsg(null), 3500)
    load()
  }

  const inRotation = team.filter(t => t.in_rotation)
  const totalWeight = inRotation.reduce((a, t) => a + t.weight, 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>نمط التوزيع التلقائي</h2>

        <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', lineHeight: 1.8 }}>
          <b>التوزيع التلقائي غير مفعّل حاليًا.</b><br />
          الأنماط أدناه محفوظة كإعداد فقط ولا يُنفَّذ أي توزيع تلقائي على الليدات
          الواردة. توزيع الليدات يتم من تبويب «توزيع يدوي».
        </div>

        {msg && (
          <div className={'alert ' + (msg.ok ? 'alert-ok' : 'alert-error')}>{msg.t}</div>
        )}

        <div style={{ opacity: .75 }}>
          {MODES.map(m => (
            <label key={m.v} className="mode-option" data-on={mode === m.v}>
              <input type="radio" name="mode" checked={mode === m.v} onChange={() => setMode(m.v)} />
              <div><b>{m.label}</b><small>{m.desc}</small></div>
            </label>
          ))}
        </div>

        <div className="field" style={{ marginTop: 16, opacity: .75 }}>
          <label>سحب الليد غير الملموس بعد (دقائق)</label>
          <input type="number" min={5} value={minutes} onChange={e => setMinutes(e.target.value)} />
          <small style={{ color: 'var(--ink-soft)' }}>
            غير مفعّل أيضًا — يحتاج مهمة مجدولة (Cron) في قاعدة البيانات
          </small>
        </div>

        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
        </button>
      </div>

      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>الفريق ({inRotation.length})</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            الوزن والحد اليومي يُستخدمان في زر «وزّع حسب الوزن» بالتوزيع اليدوي
          </p>
        </div>
        {inRotation.length === 0 ? (
          <div className="empty">
            <strong>لا أحد مُفعّل في التوزيع</strong>
            فعّل "يدخل في التوزيع التلقائي" لأي موظف من صفحة الموظفين
          </div>
        ) : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>الموظف</th><th>الوزن</th><th>نصيبه المتوقع</th><th>الحد اليومي</th><th>اللغات</th></tr>
            </thead>
            <tbody>
              {inRotation.map(t => (
                <tr key={t.full_name}>
                  <td style={{ fontWeight: 600 }}>{t.full_name}</td>
                  <td>{t.weight}</td>
                  <td>{totalWeight ? Math.round((t.weight / totalWeight) * 100) + '٪' : '—'}</td>
                  <td>{t.daily_cap}/يوم</td>
                  <td>{(t.languages ?? []).join('، ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
