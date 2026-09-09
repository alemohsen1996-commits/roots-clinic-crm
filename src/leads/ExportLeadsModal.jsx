// تصدير الليدات إلى ملف CSV يفتح مباشرة في إكسيل
// يجلب على دفعات (1000 صف) ليتحمّل عشرات الآلاف بدون تعليق المتصفح
import { useState } from 'react'
import { supabase } from '../lib/supabase'

const BATCH = 1000

const COLUMNS = `
  id, file_no, full_name, phone, country, city, age, occupation,
  procedure_interest, offered_price, offer_details, attempts,
  created_at, last_activity, snooze_until, follow_paused,
  stages(name_ar, board),
  lead_sources(name_ar),
  branches(name),
  owner:profiles!leads_owner_id_fkey(full_name),
  coordinator:profiles!leads_coordinator_id_fkey(full_name)
`

const HEADERS = [
  'رقم الملف', 'الاسم', 'الهاتف', 'الدولة', 'المدينة',
  'المرحلة', 'البورد', 'المصدر', 'الفرع',
  'المسؤول (مبيعات)', 'المنسقة',
  'الاهتمام', 'السعر المعروض', 'تفاصيل العرض',
  'العمر', 'المهنة', 'المحاولات',
  'المتابعة موقوفة', 'تاريخ الإنشاء', 'آخر نشاط',
]

const BOARD_AR = { sales: 'مبيعات', coordinator: 'منسقات' }
const INTEREST_AR = { hair: 'زراعة شعر', beard: 'لحية', eyebrows: 'حواجب', prp: 'بلازما' }

const d = (v) => (v ? new Date(v).toLocaleString('ar-EG') : '')

function toRow(l) {
  return [
    l.file_no, l.full_name, l.phone, l.country, l.city,
    l.stages?.name_ar, BOARD_AR[l.stages?.board] ?? '',
    l.lead_sources?.name_ar, l.branches?.name,
    l.owner?.full_name, l.coordinator?.full_name,
    INTEREST_AR[l.procedure_interest] ?? l.procedure_interest,
    l.offered_price, l.offer_details,
    l.age, l.occupation, l.attempts,
    l.follow_paused ? 'نعم' : 'لا',
    d(l.created_at), d(l.last_activity),
  ]
}

// تهيئة خلية CSV: تهريب علامات التنصيص والأسطر، ومنع تنفيذ الصيغ في إكسيل
function cell(v) {
  if (v === null || v === undefined) return '""'
  let s = String(v)
  if (/^[=+\-@]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

export default function ExportLeadsModal({ boardStageIds, board, filters, onClose }) {
  const [scope, setScope] = useState('board')      // board | all
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [useFilters, setUseFilters] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [err, setErr] = useState('')

  function buildQuery(rangeFrom, rangeTo) {
    let q = supabase.from('leads')
      .select(COLUMNS)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo)

    if (scope === 'board' && boardStageIds?.length) q = q.in('stage_id', boardStageIds)
    if (from) q = q.gte('created_at', from)
    if (to)   q = q.lte('created_at', to + 'T23:59:59')

    // الفلاتر التي تُطبَّق على مستوى القاعدة فقط
    if (useFilters && filters) {
      if (filters.stage)    q = q.eq('stage_id', filters.stage)
      if (filters.source)   q = q.eq('source_id', filters.source)
      if (filters.owner)    q = q.eq('owner_id', filters.owner)
      if (filters.branch)   q = q.eq('branch_id', filters.branch)
      if (filters.interest) q = q.eq('procedure_interest', filters.interest)
      if (filters.noOwner)  q = q.is('owner_id', null)
      if (filters.paused)   q = q.eq('follow_paused', true)
      if (filters.search) {
        const s = filters.search.trim()
        q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,file_no.ilike.%${s}%`)
      }
    }
    return q
  }

  async function run() {
    setBusy(true); setErr(''); setDone(0)
    const all = []
    let offset = 0

    try {
      for (;;) {
        const { data, error } = await buildQuery(offset, offset + BATCH - 1)
        if (error) throw error
        const batch = data ?? []
        all.push(...batch)
        setDone(all.length)
        if (batch.length < BATCH) break
        offset += BATCH
        if (offset > 200000) break   // حاجز أمان
      }

      if (all.length === 0) {
        setErr('لا توجد ليدات مطابقة للتصدير')
        setBusy(false)
        return
      }

      const lines = [
        HEADERS.map(cell).join(','),
        ...all.map(l => toRow(l).map(cell).join(',')),
      ]
      // BOM ضروري ليقرأ إكسيل العربية بشكل صحيح
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
        type: 'text/csv;charset=utf-8;',
      })

      const stamp = new Date().toISOString().slice(0, 10)
      const name = `leads-${scope === 'board' ? board : 'all'}-${stamp}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)

      setBusy(false)
      onClose()
    } catch (e) {
      setErr('تعذر التصدير — ' + (e.message || ''))
      setBusy(false)
    }
  }

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card" style={{
        maxWidth: 520, width: '92%', margin: '80px auto', padding: 22,
        position: 'relative', zIndex: 2,
      }}>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>تصدير الليدات</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 16 }}>
          ملف CSV يفتح مباشرة في إكسيل — يدعم العربية
        </p>

        {err && <div className="alert alert-error">{err}</div>}

        <div className="field">
          <label>النطاق</label>
          <select value={scope} onChange={e => setScope(e.target.value)} disabled={busy}>
            <option value="board">
              البورد الحالي ({board === 'sales' ? 'المبيعات' : 'المنسقات'})
            </option>
            <option value="all">كل الليدات في النظام</option>
          </select>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>من تاريخ</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} disabled={busy} />
          </div>
          <div className="field">
            <label>إلى تاريخ</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} disabled={busy} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: -6, marginBottom: 14 }}>
          اتركهما فارغين لتصدير كل الفترات
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, marginBottom: 16 }}>
          <input type="checkbox" checked={useFilters} disabled={busy}
            onChange={e => setUseFilters(e.target.checked)} style={{ width: 16, height: 16 }} />
          طبّق الفلاتر الظاهرة على الشاشة
        </label>

        {busy && (
          <div className="alert alert-ok">
            جارٍ التحضير… تم جلب {done.toLocaleString('ar-EG')} ليد
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            {busy ? 'جارٍ التصدير…' : 'تصدير الآن'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>إلغاء</button>
        </div>

        <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 14, lineHeight: 1.7 }}>
          ملاحظة: الشرائح السريعة المعتمدة على التاسكات (علامة حمراء، تاسك اليوم،
          تاسك متأخر، بدون تاسك) لا تُطبَّق على التصدير — استخدم فلاتر التاريخ والمرحلة بدلًا منها.
        </p>
      </div>
    </div>
  )
}
