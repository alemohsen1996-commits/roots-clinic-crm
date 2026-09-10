// اللوحة الجانبية لتفاصيل الليد
// مرتّبة حسب أولوية عمل الموظف: تواصل → متابعة → مرحلة → العرض → بيانات → سجل
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime } from '../lib/format'
import TaskSection from './TaskSection'

const ACTIVITY_LABEL = {
  call: 'مكالمة', note: 'ملاحظة', whatsapp: 'واتساب', sms: 'رسالة نصية',
  email: 'بريد', stage_change: 'تغيير مرحلة', assignment: 'إسناد', system: 'النظام',
  offer: 'العرض المقدّم',
}

// تصنيف السجل للتبويبات
const ACT_GROUP = {
  call: 'comm', whatsapp: 'comm', sms: 'comm', email: 'comm',
  note: 'note',
  offer: 'offer',
  stage_change: 'sys', assignment: 'sys', system: 'sys',
}

// سلسلة "لا يرد" تُبنى من المراحل الفعلية في القاعدة،
// فأي مرحلة جديدة (لا يرد 5، 6 …) تنضمّ تلقائيًا بلا تعديل كود
const NO_ANSWER_RE = /^no[_-]?response[_-]?(\d+)$/i

function buildNoAnswerChain(stages) {
  return (stages ?? [])
    .filter(s => NO_ANSWER_RE.test(s.code ?? ''))
    .map(s => ({ ...s, seq: Number((s.code.match(NO_ANSWER_RE) || [])[1] || 0) }))
    .sort((a, b) => a.seq - b.seq || a.sort_order - b.sort_order)
}

const waNumber = (phone) => String(phone ?? '').replace(/\D/g, '')

export default function LeadDrawer({ leadId, refs, onClose, onChanged }) {
  const { profile, isManager, roleCode } = useAuth()
  const [lead, setLead] = useState(null)
  const [acts, setActs] = useState([])
  const [openTask, setOpenTask] = useState(null)
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState('note')
  const [stageTo, setStageTo] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [coordinatorId, setCoordinatorId] = useState('')
  const [coordinators, setCoordinators] = useState([])
  const [branches, setBranches] = useState([])
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  // طي/فتح الأقسام الأقل استخدامًا
  const [showInfo, setShowInfo] = useState(false)
  const [actTab, setActTab] = useState('all')

  // تعديل البيانات
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState({ full_name: '', phone: '', age: '', occupation: '', branch_id: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteText, setDeleteText] = useState('')

  // العرض المقدّم (سعر + تفاصيل)
  const [offer, setOffer] = useState({ offered_price: '', offer_details: '' })
  const [savingOffer, setSavingOffer] = useState(false)
  const [offerMsg, setOfferMsg] = useState(null)   // { ok, text } — تظهر بجوار الزر
  const [offerDirty, setOfferDirty] = useState(false)
  const [editingOffer, setEditingOffer] = useState(false)

  const load = useCallback(async () => {
    const [{ data: l }, { data: a }, { data: t }] = await Promise.all([
      supabase.from('leads')
        .select('*, stages(code, name_ar, color, category, board), lead_sources(name_ar), owner:profiles!leads_owner_id_fkey(full_name), coordinator:profiles!leads_coordinator_id_fkey(full_name), branches(name)')
        .eq('id', leadId).single(),
      supabase.from('activities')
        .select('*, profiles(full_name), f:stages!activities_from_stage_fkey(name_ar), t:stages!activities_to_stage_fkey(name_ar)')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('tasks')
        .select('id, due_at, note').eq('lead_id', leadId).eq('status', 'open')
        .order('due_at', { ascending: true }).limit(1),
    ])
    setLead(l)
    setActs(a ?? [])
    setOpenTask(t?.[0] ?? null)
    setStageTo(l?.stage_id ?? '')
    setCoordinatorId(l?.coordinator_id ?? '')
    setEdit({
      full_name: l?.full_name ?? '', phone: l?.phone ?? '',
      age: l?.age ?? '', occupation: l?.occupation ?? '',
      branch_id: l?.branch_id ?? '',
    })
    setOffer({
      offered_price: l?.offered_price ?? '',
      offer_details: l?.offer_details ?? '',
    })
  }, [leadId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    supabase.from('roles').select('id').eq('code', 'coordinator').single()
      .then(({ data: role }) => {
        if (!role) { setCoordinators([]); return }
        supabase.from('profiles')
          .select('id, full_name')
          .eq('status', 'active')
          .eq('role_id', role.id)
          .then(({ data }) => setCoordinators(data ?? []))
      })
    supabase.from('branches').select('id, name').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  const currentBoard = lead?.stages?.board ?? 'sales'
  const isSalesOwner = roleCode === 'agent' && lead?.owner_id === profile?.id
  const readOnlyForSales = isSalesOwner && currentBoard === 'coordinator'

  const targetStages = refs.stages.filter(s => {
    if (isManager) return true
    const b = s.board ?? 'sales'
    if (b === currentBoard) return true
    if (currentBoard === 'sales' && s.code === 'followup') return true
    return false
  })

  const targetStage = refs.stages.find(s => s.id === Number(stageTo))
  const needsLostReason = targetStage?.code === 'lost'
  const movingToFollowup = targetStage?.code === 'followup' && lead?.stages?.code !== 'followup'

  function say(m) { setFlash(m); setTimeout(() => setFlash(''), 2500) }

  async function changeStage() {
    if (Number(stageTo) === lead.stage_id) return
    if (needsLostReason && !lostReason) { setErr('اختر سبب الخسارة أولًا'); return }
    if (movingToFollowup && !coordinatorId) { setErr('اختر المنسقة المسؤولة قبل التحويل للمتابعة'); return }

    // إرجاع من بورد المنسقات إلى المبيعات — قرار مؤثّر، نطلب تأكيدًا
    const backToSales = currentBoard === 'coordinator'
      && (targetStage?.board ?? 'sales') === 'sales'
    if (backToSales) {
      const ok = window.confirm(
        `سيعود ${lead.full_name} إلى بورد المبيعات وتفقد المنسقة السيطرة عليه.\n\nهل أنت متأكد؟`
      )
      if (!ok) return
    }

    setErr('')
    const { error } = await supabase.from('leads').update({
      stage_id: Number(stageTo),
      ...(needsLostReason && { lost_reason_id: Number(lostReason) }),
      ...(movingToFollowup && { coordinator_id: coordinatorId }),
    }).eq('id', leadId)
    if (error) {
      setErr(error.message?.includes('غير مصرح')
        ? 'إرجاع المريض لبورد المبيعات يتم عبر المدير فقط'
        : 'تعذر تغيير المرحلة')
      return
    }
    await load()
    onChanged()
  }

  async function saveEdit() {
    if (!edit.full_name.trim() || !edit.phone.trim()) { setErr('الاسم والهاتف مطلوبان'); return }
    setErr(''); setSavingEdit(true)
    const { error } = await supabase.from('leads').update({
      full_name: edit.full_name.trim(),
      phone: edit.phone.trim(),
      age: edit.age ? Number(edit.age) : null,
      occupation: edit.occupation || null,
      branch_id: edit.branch_id ? Number(edit.branch_id) : null,
    }).eq('id', leadId)
    setSavingEdit(false)
    if (error) {
      setErr(error.message.includes('uq_leads_phone') || error.message.includes('phone')
        ? 'هذا الرقم مسجل بالفعل لعميل آخر'
        : 'تعذر حفظ التعديل')
      return
    }
    setEditing(false)
    await load()
    onChanged()
  }

  async function saveOffer() {
    setSavingOffer(true); setOfferMsg(null)
    const { error } = await supabase.from('leads').update({
      offered_price: offer.offered_price ? Number(offer.offered_price) : null,
      offer_details: offer.offer_details.trim() || null,
    }).eq('id', leadId)
    setSavingOffer(false)

    if (error) {
      // الخطأ الأشيع: عمود offer_details غير موجود (لم يُنفَّذ ملف 030)
      const missingCol = /offer_details/i.test(error.message || '')
      setOfferMsg({
        ok: false,
        text: missingCol
          ? 'خانة التفاصيل غير موجودة في القاعدة — نفّذ ملف 030_offer_details.sql'
          : 'تعذر الحفظ — ' + (error.message || ''),
      })
      return
    }

    // سجل مفصّل: من كم إلى كم — يظهر في تبويب "العروض"
    const oldPrice = lead.offered_price ? Number(lead.offered_price) : null
    const newPrice = offer.offered_price ? Number(offer.offered_price) : null
    const priceLine = oldPrice && newPrice && oldPrice !== newPrice
      ? `تعديل السعر من ${oldPrice.toLocaleString('en-US')} إلى ${newPrice.toLocaleString('en-US')} ر.س`
      : newPrice
        ? `السعر: ${newPrice.toLocaleString('en-US')} ر.س`
        : 'بدون سعر'

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'offer',
      content: `${priceLine}\n${offer.offer_details.trim()}`.trim(),
    })

    setOfferDirty(false)
    setEditingOffer(false)
    setOfferMsg({ ok: true, text: '✓ تم حفظ العرض' })
    setTimeout(() => setOfferMsg(null), 4000)
    await load(); onChanged()
  }

  function cancelOfferEdit() {
    setOffer({
      offered_price: lead?.offered_price ?? '',
      offer_details: lead?.offer_details ?? '',
    })
    setOfferDirty(false)
    setEditingOffer(false)
    setOfferMsg(null)
  }

  async function addActivity() {
    if (!note.trim()) return
    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: noteType, content: note.trim(),
    })
    await supabase.from('leads').update({ last_activity: new Date().toISOString() }).eq('id', leadId)
    setNote('')
    await load()
    onChanged()
  }

  // ---------- إجراء سريع: لم يرد ----------
  // يسجّل النشاط + يزيد عدّاد المحاولات + ينقل للمرحلة التالية في سلسلة "لا يرد"
  // نقل المرحلة يحدث فقط داخل بورد المبيعات — حتى لا يُسحب المريض من المنسقة
  async function markNoAnswer() {
    setBusy(true); setErr('')
    const canMoveStage = currentBoard === 'sales' && !readOnlyForSales
    const chain = buildNoAnswerChain(refs.stages)
    const code = lead.stages?.code
    const idx = chain.findIndex(s => s.code === code)
    let nextStageId = null
    if (canMoveStage && chain.length) {
      if (idx === -1) {
        // ليس في السلسلة بعد → أول مرحلة "لا يرد"
        nextStageId = chain[0].id
      } else if (idx < chain.length - 1) {
        nextStageId = chain[idx + 1].id
      }
      // في آخر السلسلة: يبقى مكانه ويزيد العدّاد فقط
    }

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'call', content: 'اتصال — لم يرد',
    })
    await supabase.from('leads').update({
      attempts: (lead.attempts ?? 0) + 1,
      last_activity: new Date().toISOString(),
      ...(nextStageId ? { stage_id: nextStageId } : {}),
    }).eq('id', leadId)

    setBusy(false)
    say(nextStageId ? 'سُجِّل "لم يرد" ونُقل للمرحلة التالية' : 'سُجِّل "لم يرد"')
    await load(); onChanged()
  }

  // إجراء سريع: تم التواصل
  // ينقل من أي مرحلة مبكرة (جديد / لا يرد ١-٣) إلى "تم التواصل"
  // ولا يعمل إطلاقًا على بورد المنسقات
  async function markContacted() {
    setBusy(true)
    const canMoveStage = currentBoard === 'sales' && !readOnlyForSales
    const contacted = refs.stages.find(s => s.code === 'contacted')
    const code = lead.stages?.code
    const chainCodes = buildNoAnswerChain(refs.stages).map(s => s.code)
    const movable = canMoveStage && ['new', ...chainCodes].includes(code)

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'call', content: 'تم التواصل مع العميل',
    })
    await supabase.from('leads').update({
      last_activity: new Date().toISOString(),
      ...(movable && contacted ? { stage_id: contacted.id } : {}),
    }).eq('id', leadId)
    setBusy(false)
    say(movable && contacted ? 'تم التواصل — نُقل إلى "تم التواصل"' : 'تم تسجيل التواصل')
    await load(); onChanged()
  }

  async function reassign(newOwner) {
    await supabase.from('leads').update({ owner_id: newOwner }).eq('id', leadId)
    await load()
    onChanged()
  }

  async function archiveLead() {
    const { error } = await supabase.rpc('archive_lead', { p_lead_id: leadId })
    if (error) { setErr('تعذر الأرشفة'); return }
    onChanged(); onClose()
  }

  async function deleteLeadPermanent() {
    const { error } = await supabase.rpc('delete_lead_permanent', { p_lead_id: leadId })
    if (error) { setErr('تعذر المسح — قد يكون هناك بيانات مرتبطة'); return }
    onChanged(); onClose()
  }

  if (!lead) return null

  const setE = (k, v) => setEdit(s => ({ ...s, [k]: v }))
  const setO = (k, v) => {
    setOffer(s => ({ ...s, [k]: v }))
    setOfferDirty(true)
    setOfferMsg(null)
  }

  // حالة المتابعة للشارة العلوية
  const hasOffer = !!(lead.offered_price || lead.offer_details)
  const taskLate = openTask && new Date(openTask.due_at) < new Date()
  const paused = lead.follow_paused

  const shownActs = acts.filter(a =>
    actTab === 'all' ? true : ACT_GROUP[a.type] === actTab)

  return (
    <div className="drawer-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className="drawer">

        {/* ===== الرأس: الاسم + الرقم + تواصل مباشر ===== */}
        <header className="drawer-head">
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-soft)' }}>{lead.file_no}</div>
            <h2>{lead.full_name}</h2>
            <div dir="ltr" style={{ textAlign: 'right', color: 'var(--ink-soft)', fontSize: 13.5 }}>{lead.phone}</div>

            {/* أزرار التواصل — أكثر إجراء يتكرر يوميًا */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={`tel:${lead.phone}`}
                style={{ textDecoration: 'none' }}>☎ اتصال</a>
              <a className="btn btn-ghost" target="_blank" rel="noreferrer"
                href={`https://wa.me/${waNumber(lead.phone)}`}
                style={{ textDecoration: 'none' }}>واتساب</a>
              <button className="btn btn-ghost"
                onClick={() => { navigator.clipboard?.writeText(lead.phone ?? ''); say('تم نسخ الرقم') }}>
                نسخ الرقم
              </button>
            </div>

            {/* حالة المتابعة — مرئية فورًا بدون نزول */}
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="badge" style={{
                background: (lead.stages?.color ?? '#888') + '22',
                color: lead.stages?.color ?? '#888',
              }}>
                {lead.stages?.name_ar}
              </span>
              {paused ? (
                <span className="badge badge-suspended">⏹ المتابعة موقوفة</span>
              ) : openTask ? (
                <span className="badge" style={{
                  background: taskLate ? 'var(--danger-soft)' : 'var(--primary)' + '18',
                  color: taskLate ? 'var(--danger)' : 'var(--primary)',
                  fontWeight: 700,
                }}>
                  {taskLate ? '⚠ متابعة متأخرة' : '⏰ متابعة'} · {fmtDateTime(openTask.due_at)}
                </span>
              ) : (
                <span className="badge badge-pending">لا توجد متابعة مجدولة</span>
              )}
              {lead.attempts > 0 && (
                <span className="badge" style={{ background: 'var(--surface)', color: 'var(--ink-soft)' }}>
                  محاولات: {lead.attempts}
                </span>
              )}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
        </header>

        {err && <div className="alert alert-error">{err}</div>}
        {flash && <div className="alert alert-ok">{flash}</div>}

        {readOnlyForSales && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 4px',
            background: 'var(--surface)', padding: '8px 12px', borderRadius: 8 }}>
            👁 هذا المريض تحت إدارة المنسقة الآن — يمكنك متابعة حالته فقط
          </div>
        )}

        {/* ===== ١. تسجيل نشاط + إجراءات سريعة ===== */}
        {!readOnlyForSales && (
          <div className="drawer-section">
            <h3>تسجيل نشاط</h3>

            {currentBoard === 'sales' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <button className="btn btn-ghost" disabled={busy} onClick={markNoAnswer}
                  title={(() => {
                    const chain = buildNoAnswerChain(refs.stages)
                    const i = chain.findIndex(s => s.code === lead.stages?.code)
                    if (!chain.length) return 'يسجّل محاولة اتصال'
                    if (i === -1) return `يسجّل المحاولة وينقل إلى «${chain[0].name_ar}»`
                    if (i < chain.length - 1) return `يسجّل المحاولة وينقل إلى «${chain[i + 1].name_ar}»`
                    return 'آخر مرحلة في السلسلة — يزيد عدّاد المحاولات فقط'
                  })()}>
                  ☎ لم يرد
                </button>
                <button className="btn btn-ghost" disabled={busy} onClick={markContacted}>
                  ✓ تم التواصل
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <select value={noteType} onChange={e => setNoteType(e.target.value)} style={{ width: 110 }}>
                <option value="note">ملاحظة</option>
                <option value="call">مكالمة</option>
                <option value="whatsapp">واتساب</option>
              </select>
              <input style={{ flex: 1 }} value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addActivity()}
                placeholder="ماذا حدث في هذا التواصل؟" />
              <button className="btn btn-primary" onClick={addActivity} disabled={!note.trim()}>حفظ</button>
            </div>
          </div>
        )}

        {/* ===== ٢. مهمة المتابعة ===== */}
        <TaskSection leadId={leadId} leadOwnerId={lead.owner_id} onChanged={() => { load(); onChanged() }} />

        {/* ===== ٣. المرحلة ===== */}
        <div className="drawer-section">
          <h3>المرحلة {currentBoard === 'coordinator' ? '(بورد المنسقات)' : '(بورد المبيعات)'}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={stageTo} onChange={e => { setStageTo(e.target.value); setErr('') }}
              disabled={readOnlyForSales}
              style={{ flex: 1, minWidth: 160 }}>
              {targetStages.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name_ar}{(s.board ?? 'sales') !== currentBoard ? ' ← تحويل للمنسقة' : ''}
                </option>
              ))}
            </select>
            {needsLostReason && (
              <select value={lostReason} onChange={e => setLostReason(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}>
                <option value="">— سبب الخسارة —</option>
                {refs.lostReasons.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
              </select>
            )}
          </div>

          {movingToFollowup && (
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 6 }}>
                المنسقة المسؤولة *
              </label>
              <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}
                style={{ width: '100%' }}>
                <option value="">— اختر المنسقة —</option>
                {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
              <p style={{ fontSize: 12, color: 'var(--warn)', marginTop: 6 }}>
                بعد التحويل ينتقل المريض لبورد المنسقات وتصبح هي المتحكمة فيه
              </p>
              {!offer.offer_details.trim() && (
                <p style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 6, fontWeight: 600 }}>
                  ⚠ لم تكتب تفاصيل العرض — المنسقة لن تعرف ما عُرض على العميل
                </p>
              )}
            </div>
          )}

          {!readOnlyForSales && (
            <button className="btn btn-primary" style={{ marginTop: 10 }}
              disabled={Number(stageTo) === lead.stage_id}
              onClick={changeStage}>
              نقل
            </button>
          )}

          {targetStage?.code === 'deal' && (
            <p style={{ fontSize: 12.5, color: 'var(--warn)', marginTop: 8 }}>
              عند النقل للديل ستحتاج فتح ملف تعاقد من صفحة الديلات
            </p>
          )}
          {lead.stages?.code === 'deal' && (
            <a href={`/deals?lead=${lead.id}`} className="btn btn-primary"
              style={{ display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>
              فتح ملف التعاقد ←
            </a>
          )}
        </div>

        {/* ===== ٤. العرض المقدّم للعميل ===== */}
        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>العرض المقدّم للعميل</h3>
            {!editingOffer && !readOnlyForSales && hasOffer && (
              <button className="btn btn-ghost" style={{ padding: '6px 14px' }}
                onClick={() => { setEditingOffer(true); setOfferMsg(null) }}>
                تعديل
              </button>
            )}
          </div>

          {/* ---- وضع العرض (مقروء) ---- */}
          {(!editingOffer || readOnlyForSales) && hasOffer && (
            <div className="offer-box">
              <div className="offer-price">
                {lead.offered_price
                  ? `${Number(lead.offered_price).toLocaleString('en-US')} ر.س`
                  : 'السعر غير محدّد'}
              </div>

              {lead.offer_details ? (
                <ul className="offer-list">
                  {String(lead.offer_details)
                    .split('\n')
                    .map(x => x.replace(/^[•\-*\s]+/, '').trim())
                    .filter(Boolean)
                    .map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--warn)', marginTop: 8, fontWeight: 600 }}>
                  ⚠ لا توجد تفاصيل — المنسقة لن تعرف ما عُرض على العميل
                </div>
              )}

              {offerMsg?.ok && (
                <div style={{ fontSize: 12.5, color: 'var(--ok)', fontWeight: 700, marginTop: 10 }}>
                  {offerMsg.text}
                </div>
              )}
            </div>
          )}

          {/* ---- لا يوجد عرض بعد ---- */}
          {!hasOffer && !editingOffer && !readOnlyForSales && (
            <div className="offer-box" style={{ borderStyle: 'dashed' }}>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
                لم يُسجَّل عرض بعد — سجّله ليصل للمنسقة مع العميل
              </div>
              <button className="btn btn-primary" onClick={() => setEditingOffer(true)}>
                تسجيل العرض
              </button>
            </div>
          )}
          {!hasOffer && readOnlyForSales && (
            <div className="offer-box" style={{ borderStyle: 'dashed' }}>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>لم يُسجَّل عرض</div>
            </div>
          )}

          {/* ---- وضع التحرير ---- */}
          {editingOffer && !readOnlyForSales && (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                اكتب كل بند في سطر مستقل — المنسقة تقرأ هذا عند استلام العميل
              </p>
              <div className="field">
                <label>السعر المعروض (ر.س)</label>
                <input type="number" min={0} value={offer.offered_price}
                  onChange={e => setO('offered_price', e.target.value)}
                  placeholder="السعر الذي عُرض على العميل" />
              </div>
              <div className="field">
                <label>تفاصيل العرض — بند في كل سطر</label>
                <textarea rows={6} value={offer.offer_details}
                  onChange={e => setO('offer_details', e.target.value)}
                  placeholder={'4000 شعيرة بتقنية السفير\nجلستان بلازما مجانًا\nإقامة ليلتين فندق + مواصلات من المطار\nغسيل أول بالعيادة'}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)',
                    fontSize: 13.5, lineHeight: 1.9, resize: 'vertical',
                  }} />
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={saveOffer} disabled={savingOffer}>
                  {savingOffer ? 'جارٍ الحفظ…' : 'حفظ العرض'}
                </button>
                <button className="btn btn-ghost" onClick={cancelOfferEdit}>إلغاء</button>

                {offerMsg && !offerMsg.ok && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>
                    {offerMsg.text}
                  </span>
                )}
                {!offerMsg && offerDirty && (
                  <span style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>
                    ● تغييرات غير محفوظة
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* ===== ٥. بيانات العميل — مطوية ===== */}
        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button className="btn btn-ghost" style={{ padding: '4px 0', border: 'none' }}
              onClick={() => setShowInfo(v => !v)}>
              <h3 style={{ margin: 0 }}>{showInfo ? '▾' : '▸'} بيانات العميل</h3>
            </button>
            {showInfo && !editing && !readOnlyForSales && (
              <button className="btn btn-ghost" style={{ padding: '6px 14px' }} onClick={() => setEditing(true)}>
                تعديل
              </button>
            )}
          </div>

          {!showInfo && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 6 }}>
              {[
                lead.age ? `${lead.age} سنة` : null,
                lead.occupation,
                lead.branches?.name,
                lead.lead_sources?.name_ar,
                lead.owner?.full_name ? `مسؤول: ${lead.owner.full_name}` : null,
              ].filter(Boolean).join(' · ') || 'لا بيانات مسجّلة — اضغط للفتح'}
            </div>
          )}

          {showInfo && (editing ? (
            <>
              <div className="grid-2">
                <div className="field">
                  <label>الاسم</label>
                  <input value={edit.full_name} onChange={e => setE('full_name', e.target.value)} />
                </div>
                <div className="field">
                  <label>الهاتف</label>
                  <input dir="ltr" value={edit.phone} onChange={e => setE('phone', e.target.value)} />
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>العمر</label>
                  <input type="number" min={0} max={120} value={edit.age}
                    onChange={e => setE('age', e.target.value)} />
                </div>
                <div className="field">
                  <label>المهنة</label>
                  <input value={edit.occupation} onChange={e => setE('occupation', e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>الفرع</label>
                <select value={edit.branch_id} onChange={e => setE('branch_id', e.target.value)}>
                  <option value="">— بدون —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
                  {savingEdit ? 'جارٍ الحفظ…' : 'حفظ'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setEditing(false); load() }}>إلغاء</button>
              </div>
            </>
          ) : (
            <div className="drawer-info" style={{ marginBottom: 0, marginTop: 10 }}>
              <div><span>العمر</span>{lead.age ?? '—'}</div>
              <div><span>المهنة</span>{lead.occupation ?? '—'}</div>
              <div><span>الفرع</span>{lead.branches?.name ?? '—'}</div>
              <div><span>المصدر</span>{lead.lead_sources?.name_ar ?? '—'}</div>
              <div><span>المسؤول (مبيعات)</span>{lead.owner?.full_name ?? 'غير مسند'}</div>
              <div><span>المنسقة</span>{lead.coordinator?.full_name ?? '—'}</div>
            </div>
          ))}
        </div>

        {/* إعادة الإسناد — للمديرين */}
        {isManager && (
          <div className="drawer-section">
            <h3>إعادة الإسناد (موظف المبيعات)</h3>
            <select value={lead.owner_id ?? ''} onChange={e => reassign(e.target.value || null)}>
              <option value="">غير مسند (Pool)</option>
              {refs.agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>
        )}

        {/* ===== ٦. السجل — بتبويبات ===== */}
        <div className="drawer-section">
          <h3>السجل</h3>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {[
              { k: 'all',  l: 'الكل' },
              { k: 'comm', l: 'تواصل' },
              { k: 'note', l: 'ملاحظات' },
              { k: 'offer', l: 'العروض' },
              { k: 'sys',  l: 'تغييرات' },
            ].map(t => (
              <button key={t.k} className={'tab' + (actTab === t.k ? ' on' : '')}
                onClick={() => setActTab(t.k)}>{t.l}</button>
            ))}
          </div>
          <div className="timeline">
            {shownActs.length === 0 && <div className="empty" style={{ padding: 20 }}>لا شيء هنا</div>}
            {shownActs.map(a => (
              <div className="timeline-item" key={a.id}>
                <div className="timeline-meta">
                  <b>{ACTIVITY_LABEL[a.type] ?? a.type}</b>
                  <span>{a.profiles?.full_name ?? 'النظام'}</span>
                  <span>{fmtDateTime(a.created_at)}</span>
                </div>
                <div className="timeline-body">
                  {a.type === 'stage_change'
                    ? <>من <b>{a.f?.name_ar ?? '—'}</b> إلى <b>{a.t?.name_ar ?? '—'}</b></>
                    : <span style={{ whiteSpace: 'pre-wrap' }}>{a.content ?? ''}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* منطقة الخطر — للمدير العام فقط */}
        {isManager && (
          <div className="drawer-section danger-zone">
            <h3 style={{ color: 'var(--danger)' }}>منطقة الخطر</h3>

            <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 10 }}
              onClick={archiveLead}>
              📦 أرشفة الليد (يمكن استرجاعه)
            </button>

            {!confirmDelete ? (
              <button className="btn btn-danger" style={{ width: '100%' }}
                onClick={() => setConfirmDelete(true)}>
                🗑 مسح نهائي
              </button>
            ) : (
              <div style={{ border: '1px solid var(--danger)', borderRadius: 8, padding: 12 }}>
                <p style={{ fontSize: 12.5, color: 'var(--danger)', marginBottom: 8, fontWeight: 600 }}>
                  ⚠ هذا يمسح الليد وكل ديلاته ودفعاته نهائيًا — لا رجعة فيه.
                  اكتب <b>مسح</b> للتأكيد:
                </p>
                <input value={deleteText} onChange={e => setDeleteText(e.target.value)}
                  placeholder="اكتب: مسح" style={{ marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-danger" disabled={deleteText.trim() !== 'مسح'}
                    onClick={deleteLeadPermanent}>تأكيد المسح النهائي</button>
                  <button className="btn btn-ghost"
                    onClick={() => { setConfirmDelete(false); setDeleteText('') }}>إلغاء</button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
