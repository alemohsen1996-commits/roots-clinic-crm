// اللوحة الجانبية لتفاصيل الليد — تبويبان: «الكل» (كل الأفعال) + «السجل»
// الهيدر ثابت فوق التبويبين، وبه تعديل بيانات العميل الشامل inline
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { STAGE } from '../lib/stageCodes'
import { useAuth } from '../auth/AuthContext'
import { fmtDateTime, fmtNum, openWhatsApp } from '../lib/format'
import { emitBoardPatch } from './boardBus'
import TaskSection from './TaskSection'

const ACTIVITY_LABEL = {
  call: 'مكالمة', note: 'ملاحظة', whatsapp: 'واتساب', sms: 'رسالة نصية',
  email: 'بريد', stage_change: 'تغيير مرحلة', assignment: 'إسناد', system: 'النظام',
  offer: 'العرض المقدّم',
}

// تصنيف السجل للتبويبات الفرعية
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

export default function LeadDrawer({ leadId, refs, onClose, onChanged, siblings, onNavigate }) {
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
  const [undo, setUndo] = useState(null)          // { fromStage, toStage } — تراجع سريع بعد نقل سريع
  const [busy, setBusy] = useState(false)

  const [tab, setTab] = useState('all')           // all | log

  // زر "غير مهتم": يكشف مربّع سبب سريع قبل النقل لمرحلة الخسارة
  const [notInterestedOpen, setNotInterestedOpen] = useState(false)
  const [notInterestedReason, setNotInterestedReason] = useState('')

  // التنقّل بين الليدات المعروضة — يحترم الفلاتر والعمود الذي فُتح منه
  const navList = Array.isArray(siblings) ? siblings : []
  const navIndex = navList.findIndex(x => Number(x.id) === Number(leadId))
  const hasNav = navList.length > 1 && navIndex !== -1
  const prevLead = hasNav && navIndex > 0 ? navList[navIndex - 1] : null
  const nextLead = hasNav && navIndex < navList.length - 1 ? navList[navIndex + 1] : null

  const goTo = (l) => { if (l && onNavigate) { setTab('all'); onNavigate(l) } }
  const [actTab, setActTab] = useState('all')

  // تعديل بيانات العميل الشامل (inline في الهيدر)
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState({
    full_name: '', phone: '', age: '', occupation: '',
    country: '', city: '', language: '',
    source_id: '', branch_id: '', procedure_interest: '', budget_range: '', notes: '',
  })
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
      country: l?.country ?? '', city: l?.city ?? '', language: l?.language ?? '',
      source_id: l?.source_id ?? '', branch_id: l?.branch_id ?? '',
      procedure_interest: l?.procedure_interest ?? '', budget_range: l?.budget_range ?? '',
      notes: l?.notes ?? '',
    })
    setOffer({
      offered_price: l?.offered_price ?? '',
      offer_details: l?.offer_details ?? '',
    })
  }, [leadId])

  useEffect(() => { load() }, [load])

  // ← و → للتنقّل، Esc للإغلاق — ما لم يكن المؤشر داخل حقل إدخال
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target?.tagName
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return
      if (e.key === 'Escape') { onClose(); return }
      if (!hasNav) return
      // في الواجهة العربية: السهم الأيسر يتقدّم للتالي
      if (e.key === 'ArrowLeft')  goTo(nextLead)
      if (e.key === 'ArrowRight') goTo(prevLead)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
    if (currentBoard === 'sales' && s.code === STAGE.FOLLOWUP) return true
    return false
  })

  const targetStage = refs.stages.find(s => s.id === Number(stageTo))
  const needsLostReason = targetStage?.code === STAGE.LOST
  const movingToFollowup = targetStage?.code === STAGE.FOLLOWUP && lead?.stages?.code !== STAGE.FOLLOWUP

  // flash مع خيار تراجع اختياري (يظهر لمدة أطول عند إتاحة التراجع)
  function say(m, undoInfo = null) {
    setFlash(m)
    setUndo(undoInfo)
    setTimeout(() => { setFlash(''); setUndo(null) }, undoInfo ? 6000 : 2500)
  }

  // تراجع سريع عن آخر نقل مرحلة — يعيد المرحلة السابقة فقط
  async function undoMove() {
    if (!undo) return
    const { fromStage, toStage } = undo
    setUndo(null); setFlash('')
    await supabase.from('leads').update({
      stage_id: fromStage, last_activity: new Date().toISOString(),
    }).eq('id', leadId)
    await load()
    emitBoardPatch({ removeId: leadId, removeFrom: toStage, refetch: [fromStage] })
    onChanged()
    say('تم التراجع')
  }

  async function changeStage() {
    if (Number(stageTo) === lead.stage_id) return
    if (needsLostReason && !lostReason) { setErr('اختر سبب الخسارة أولًا'); return }
    if (movingToFollowup && !coordinatorId) { setErr('اختر المنسقة المسؤولة قبل التحويل للمتابعة'); return }
    // المنسقة تستلم العميل بناءً على العرض — التحويل بدونه يفقدها السياق
    if (movingToFollowup && !lead.offer_details?.trim()) {
      setErr('سجّل العرض المقدّم للعميل أولًا — المنسقة تحتاج معرفة ما عُرض عليه')
      return
    }
    if (movingToFollowup && !(lead.offered_price > 0)) {
      setErr('سجّل السعر المعروض أولًا')
      return
    }

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
    const fromStage = lead.stage_id      // نلتقطه قبل التحديث — بعد load() يصير المرحلة الجديدة
    const toStage = Number(stageTo)
    const { error } = await supabase.from('leads').update({
      stage_id: toStage,
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
    // نقل موضعي: العمود المصدر يشيله فورًا، والهدف يحدّث نفسه فقط
    emitBoardPatch({ removeId: leadId, removeFrom: fromStage, refetch: [toStage] })
    onChanged()
  }

  async function saveEdit() {
    if (!edit.full_name.trim() || !edit.phone.trim()) { setErr('الاسم والهاتف مطلوبان'); return }
    setErr(''); setSavingEdit(true)
    const st = lead.stage_id
    const { error } = await supabase.from('leads').update({
      full_name: edit.full_name.trim(),
      phone: edit.phone.trim(),
      age: edit.age ? Number(edit.age) : null,
      occupation: edit.occupation?.trim() || null,
      country: edit.country?.trim() || null,
      city: edit.city?.trim() || null,
      language: edit.language?.trim() || null,
      source_id: edit.source_id ? Number(edit.source_id) : null,
      branch_id: edit.branch_id ? Number(edit.branch_id) : null,
      procedure_interest: edit.procedure_interest?.trim() || null,
      budget_range: edit.budget_range?.trim() || null,
      notes: edit.notes?.trim() || null,
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
    // الاسم/الرقم يظهران على الكارت — حدّث عمود هذا الليد فقط
    emitBoardPatch({ refetch: [st] })
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
      setOfferMsg({ ok: false, text: 'تعذر الحفظ — ' + (error.message || '') })
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
    // العرض لا يظهر على كارت الكانبان — لا داعي لتحديث أي عمود
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
    const st = lead.stage_id
    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: noteType, content: note.trim(),
    })
    await supabase.from('leads').update({ last_activity: new Date().toISOString() }).eq('id', leadId)
    setNote('')
    await load()
    // آخر نشاط تغيّر (يؤثّر على الترتيب/الوقت على الكارت) — حدّث هذا العمود فقط
    emitBoardPatch({ refetch: [st] })
    onChanged()
  }

  // ---------- إجراء سريع: لم يرد ----------
  // يسجّل النشاط + يزيد عدّاد المحاولات + ينقل للمرحلة التالية في سلسلة "لا يرد"
  // نقل المرحلة يحدث فقط داخل بورد المبيعات — حتى لا يُسحب المريض من المنسقة
  async function markNoAnswer() {
    setBusy(true); setErr('')
    const fromStage = lead.stage_id
    const canMoveStage = currentBoard === 'sales' && !readOnlyForSales
    const chain = buildNoAnswerChain(refs.stages)
    const code = lead.stages?.code
    const idx = chain.findIndex(s => s.code === code)
    let nextStageId = null
    if (canMoveStage && chain.length) {
      if (idx === -1) {
        nextStageId = chain[0].id       // ليس في السلسلة بعد → أول مرحلة "لا يرد"
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
    await load()
    if (nextStageId) {
      emitBoardPatch({ removeId: leadId, removeFrom: fromStage, refetch: [nextStageId] })
      say('سُجِّل "لم يرد" ونُقل للمرحلة التالية', { fromStage, toStage: nextStageId })
    } else {
      emitBoardPatch({ refetch: [fromStage] })
      say('سُجِّل "لم يرد"')
    }
    onChanged()
  }

  // إجراء سريع: تم التواصل — ينقل من مرحلة مبكرة (جديد / لا يرد) إلى "تم التواصل"
  async function markContacted() {
    setBusy(true)
    const fromStage = lead.stage_id
    const canMoveStage = currentBoard === 'sales' && !readOnlyForSales
    const contacted = refs.stages.find(s => s.code === STAGE.CONTACTED)
    const code = lead.stages?.code
    const chainCodes = buildNoAnswerChain(refs.stages).map(s => s.code)
    const movable = canMoveStage && [STAGE.NEW, ...chainCodes].includes(code)

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'call', content: 'تم التواصل مع العميل',
    })
    await supabase.from('leads').update({
      last_activity: new Date().toISOString(),
      ...(movable && contacted ? { stage_id: contacted.id } : {}),
    }).eq('id', leadId)
    setBusy(false)
    await load()
    if (movable && contacted && contacted.id !== fromStage) {
      emitBoardPatch({ removeId: leadId, removeFrom: fromStage, refetch: [contacted.id] })
      say('تم التواصل — نُقل إلى "تم التواصل"', { fromStage, toStage: contacted.id })
    } else {
      emitBoardPatch({ refetch: [fromStage] })
      say('تم تسجيل التواصل')
    }
    onChanged()
  }

  // إجراء سريع: مهتم — ينقل إلى مرحلة "مهتم" (بورد المبيعات)
  async function markInterested() {
    setBusy(true)
    const fromStage = lead.stage_id
    const canMoveStage = currentBoard === 'sales' && !readOnlyForSales
    const interested = refs.stages.find(s => s.code === STAGE.INTERESTED)
    const movable = canMoveStage && interested && lead.stages?.code !== STAGE.INTERESTED

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'call', content: 'العميل مهتم',
    })
    await supabase.from('leads').update({
      last_activity: new Date().toISOString(),
      ...(movable ? { stage_id: interested.id } : {}),
    }).eq('id', leadId)
    setBusy(false)
    await load()
    if (movable && interested.id !== fromStage) {
      emitBoardPatch({ removeId: leadId, removeFrom: fromStage, refetch: [interested.id] })
      say('سُجِّل "مهتم"', { fromStage, toStage: interested.id })
    } else {
      emitBoardPatch({ refetch: [fromStage] })
      say('سُجِّل "مهتم"')
    }
    onChanged()
  }

  // إجراء سريع: غير مهتم — ينقل لمرحلة "غير مهتم" (dead) مع سبب اختياري
  async function markNotInterested() {
    const dead = refs.stages.find(s => s.code === STAGE.DEAD)
    if (!dead) { setErr('مرحلة "غير مهتم" غير موجودة'); return }
    setBusy(true); setErr('')
    const fromStage = lead.stage_id

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'call', content: 'العميل غير مهتم',
    })
    await supabase.from('leads').update({
      stage_id: dead.id,
      ...(notInterestedReason ? { lost_reason_id: Number(notInterestedReason) } : {}),
      last_activity: new Date().toISOString(),
    }).eq('id', leadId)
    setBusy(false)
    setNotInterestedOpen(false)
    setNotInterestedReason('')
    await load()
    emitBoardPatch({ removeId: leadId, removeFrom: fromStage, refetch: [dead.id] })
    say('سُجِّل "غير مهتم"', { fromStage, toStage: dead.id })
    onChanged()
  }

  async function reassign(newOwner) {
    const st = lead.stage_id
    await supabase.from('leads').update({ owner_id: newOwner }).eq('id', leadId)
    await load()
    emitBoardPatch({ refetch: [st] })
    onChanged()
  }

  async function archiveLead() {
    const st = lead.stage_id
    const { error } = await supabase.rpc('archive_lead', { p_lead_id: leadId })
    if (error) { setErr('تعذر الأرشفة'); return }
    emitBoardPatch({ removeId: leadId, removeFrom: st })
    onChanged(); onClose()
  }

  async function deleteLeadPermanent() {
    const st = lead.stage_id
    const { error } = await supabase.rpc('delete_lead_permanent', { p_lead_id: leadId })
    if (error) { setErr('تعذر المسح — قد يكون هناك بيانات مرتبطة'); return }
    emitBoardPatch({ removeId: leadId, removeFrom: st })
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

        {/* ===== الرأس: هوية العميل + بياناته (مع تعديل شامل inline) ===== */}
        <header className="drawer-head lead-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'monospace', fontSize: 11.5, color: 'var(--ink-soft)' }}>
              {lead.file_no}
            </div>
            <h2 style={{ marginBottom: 2 }}>{lead.full_name}</h2>

            {/* الرقم وأزرار التواصل في سطر واحد */}
            <div className="phone-cell" style={{ marginBottom: 8 }}>
              <span dir="ltr" style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{lead.phone}</span>
              <a className="icon-btn" href={`tel:${lead.phone}`} title="اتصال">☎</a>
              <button className="icon-btn" title="واتساب"
                            onClick={() => openWhatsApp(lead.phone)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                </svg>
              </button>
              <button className="icon-btn" title="نسخ الرقم"
                onClick={() => { navigator.clipboard?.writeText(lead.phone ?? ''); say('تم نسخ الرقم') }}>⧉</button>
            </div>

            {/* الحالة الحالية */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="badge" style={{
                background: (lead.stages?.color ?? '#888') + '22',
                color: lead.stages?.color ?? '#888',
              }}>
                {lead.stages?.name_ar}
              </span>
              {paused ? (
                <span className="badge badge-suspended">⏹ موقوفة</span>
              ) : openTask ? (
                <span className="badge" style={{
                  background: taskLate ? 'var(--danger-soft)' : 'var(--primary)' + '18',
                  color: taskLate ? 'var(--danger)' : 'var(--primary)',
                  fontWeight: 700,
                }}>
                  {taskLate ? '⚠' : '⏰'} {fmtDateTime(openTask.due_at)}
                </span>
              ) : (
                <span className="badge badge-pending">بلا متابعة</span>
              )}
              {lead.attempts > 0 && (
                <span className="badge" style={{ background: 'var(--surface)', color: 'var(--ink-soft)' }}>
                  محاولات: {lead.attempts}
                </span>
              )}
              {lead.offered_price > 0 && (
                <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                  {fmtNum(lead.offered_price)} ر.س
                </span>
              )}
            </div>

            {/* بيانات العميل — عرض مضغوط + قلم، أو فورم التعديل الشامل */}
            {!editing ? (
              <div>
                <div className="lead-facts">
                  <span><i>العمر</i>{lead.age ?? '—'}</span>
                  <span><i>المهنة</i>{lead.occupation ?? '—'}</span>
                  <span><i>المدينة</i>{lead.city ?? '—'}</span>
                  <span><i>الفرع</i>{lead.branches?.name ?? '—'}</span>
                  <span><i>المصدر</i>{lead.lead_sources?.name_ar ?? '—'}</span>
                  <span><i>الاهتمام</i>{lead.procedure_interest ?? '—'}</span>
                  <span><i>المسؤول</i>{lead.owner?.full_name ?? 'غير مسند'}</span>
                  {lead.coordinator?.full_name && (
                    <span><i>المنسقة</i>{lead.coordinator.full_name}</span>
                  )}
                </div>
                {!readOnlyForSales && (
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, marginTop: 6 }}
                    onClick={() => { setEditing(true); setErr('') }}>
                    ✎ تعديل البيانات
                  </button>
                )}
              </div>
            ) : (
              <div className="lead-edit">
                <div className="lead-edit-title">✎ تعديل بيانات العميل</div>

                <div className="lead-edit-group">
                  <div className="grp-label">بيانات أساسية</div>
                  <div className="lead-edit-grid">
                    <div className="field">
                      <label>الاسم *</label>
                      <input value={edit.full_name} onChange={e => setE('full_name', e.target.value)} />
                    </div>
                    <div className="field">
                      <label>الهاتف *</label>
                      <input dir="ltr" value={edit.phone} onChange={e => setE('phone', e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="lead-edit-group">
                  <div className="grp-label">معلومات شخصية</div>
                  <div className="lead-edit-grid">
                    <div className="field">
                      <label>العمر</label>
                      <input type="number" min={0} max={120} value={edit.age}
                        onChange={e => setE('age', e.target.value)} />
                    </div>
                    <div className="field">
                      <label>المهنة</label>
                      <input value={edit.occupation} onChange={e => setE('occupation', e.target.value)} />
                    </div>
                    <div className="field">
                      <label>المدينة</label>
                      <input value={edit.city} onChange={e => setE('city', e.target.value)} />
                    </div>
                    <div className="field">
                      <label>الدولة</label>
                      <input value={edit.country} onChange={e => setE('country', e.target.value)} />
                    </div>
                    <div className="field col-2">
                      <label>اللغة</label>
                      <input value={edit.language} onChange={e => setE('language', e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="lead-edit-group">
                  <div className="grp-label">تصنيف الليد</div>
                  <div className="lead-edit-grid">
                    <div className="field">
                      <label>المصدر</label>
                      <select value={edit.source_id} onChange={e => setE('source_id', e.target.value)}>
                        <option value="">— بدون —</option>
                        {refs.sources.map(s => <option key={s.id} value={s.id}>{s.name_ar}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>الفرع</label>
                      <select value={edit.branch_id} onChange={e => setE('branch_id', e.target.value)}>
                        <option value="">— بدون —</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>الاهتمام</label>
                      <input value={edit.procedure_interest}
                        onChange={e => setE('procedure_interest', e.target.value)} />
                    </div>
                    <div className="field">
                      <label>الميزانية</label>
                      <input value={edit.budget_range} onChange={e => setE('budget_range', e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="lead-edit-group">
                  <div className="grp-label">ملاحظات</div>
                  <div className="lead-edit-grid">
                    <div className="field col-2">
                      <textarea rows={2} value={edit.notes}
                        onChange={e => setE('notes', e.target.value)}
                        placeholder="ملاحظات عن العميل…" />
                    </div>
                  </div>
                </div>

                <div className="lead-edit-actions">
                  <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
                    {savingEdit ? 'جارٍ الحفظ…' : 'حفظ'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setEditing(false); setErr(''); load() }}>
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="head-actions">
            {hasNav && (
              <div className="nav-pager" title="استخدم ← و → للتنقّل">
                <button className="icon-btn" disabled={!prevLead}
                  onClick={() => goTo(prevLead)} title="السابق">→</button>
                <span className="nav-pos">{navIndex + 1} من {navList.length}</span>
                <button className="icon-btn" disabled={!nextLead}
                  onClick={() => goTo(nextLead)} title="التالي">←</button>
              </div>
            )}
            <button className="btn btn-ghost" onClick={onClose}>إغلاق</button>
          </div>
        </header>

        {err && <div className="alert alert-error">{err}</div>}
        {flash && (
          <div className="alert alert-ok"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>{flash}</span>
            {undo && (
              <button className="btn btn-ghost" style={{ padding: '4px 12px' }} onClick={undoMove}>
                ↩ تراجع
              </button>
            )}
          </div>
        )}

        {readOnlyForSales && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)',
            background: 'var(--surface)', padding: '8px 12px', borderRadius: 8, marginBottom: 10 }}>
            👁 هذا المريض تحت إدارة المنسقة الآن — يمكنك متابعة حالته فقط
          </div>
        )}

        {/* ===== تبويبان فقط ===== */}
        <div className="tabs drawer-tabs">
          {[
            { k: 'all', l: 'الكل' },
            { k: 'log', l: 'السجل' },
          ].map(t => (
            <button key={t.k} className={'tab' + (tab === t.k ? ' on' : '')}
              onClick={() => setTab(t.k)}>{t.l}</button>
          ))}
        </div>

        {tab === 'all' && (<>

        {/* تسجيل نشاط + أزرار النتيجة السريعة */}
        {!readOnlyForSales && (
          <div className="act-box">
            <div className="row-label">ماذا حدث في هذا التواصل؟</div>

            {currentBoard === 'sales' && (
              <div className="quick-acts">
                <button className="act-chip no" disabled={busy} onClick={markNoAnswer}
                  title={(() => {
                    const chain = buildNoAnswerChain(refs.stages)
                    const i = chain.findIndex(x => x.code === lead.stages?.code)
                    if (!chain.length) return 'يسجّل محاولة اتصال'
                    if (i === -1) return `ينقل إلى «${chain[0].name_ar}»`
                    if (i < chain.length - 1) return `ينقل إلى «${chain[i + 1].name_ar}»`
                    return 'آخر مرحلة — يزيد العدّاد فقط'
                  })()}>
                  ☎ لم يرد
                </button>
                <button className="act-chip yes" disabled={busy} onClick={markContacted}>
                  ✓ تم التواصل
                </button>
                <button className="act-chip" disabled={busy} onClick={markInterested}
                  style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>
                  ♥ مهتم
                </button>
                <button className="act-chip" disabled={busy}
                  onClick={() => { setNotInterestedOpen(v => !v); setErr('') }}
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                  ✕ غير مهتم
                </button>
              </div>
            )}

            {/* غير مهتم: سبب سريع قبل النقل لمرحلة الخسارة */}
            {currentBoard === 'sales' && notInterestedOpen && (
              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                <label>سبب عدم الاهتمام (اختياري)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={notInterestedReason}
                    onChange={e => setNotInterestedReason(e.target.value)} style={{ flex: 1 }}>
                    <option value="">— بدون سبب —</option>
                    {refs.lostReasons.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
                  </select>
                  <button className="btn btn-danger" disabled={busy} onClick={markNotInterested}>
                    تأكيد
                  </button>
                </div>
              </div>
            )}

            <div className="note-row">
              <input className="note-input" value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addActivity()}
                placeholder="اكتب تفاصيل التواصل…" />
              <select className="note-type" value={noteType} onChange={e => setNoteType(e.target.value)}>
                <option value="note">ملاحظة</option>
                <option value="call">مكالمة</option>
                <option value="whatsapp">واتساب</option>
              </select>
              <button className="btn btn-primary" onClick={addActivity} disabled={!note.trim()}>
                حفظ
              </button>
            </div>
          </div>
        )}

        {/* العرض المقدّم — ارتفاع ثابت مع اسكرول */}
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

          {/* ---- وضع العرض (مقروء) — ارتفاع محدود + اسكرول ---- */}
          {(!editingOffer || readOnlyForSales) && hasOffer && (
            <div className="offer-box">
              <div className="offer-price">
                {lead.offered_price
                  ? `${Number(lead.offered_price).toLocaleString('en-US')} ر.س`
                  : 'السعر غير محدّد'}
              </div>

              {lead.offer_details ? (
                <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 6 }}>
                  <ul className="offer-list">
                    {String(lead.offer_details)
                      .split('\n')
                      .map(x => x.replace(/^[•\-*\s]+/, '').trim())
                      .filter(Boolean)
                      .map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
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

        {/* نقل المرحلة — مباشرة تحت العرض */}
        <div className="stage-box">
          <div className="row-label">
            نقل المرحلة {currentBoard === 'coordinator' ? '· بورد المنسقات' : '· بورد المبيعات'}
          </div>

          <div className="stage-row">
            <select value={stageTo} onChange={e => { setStageTo(e.target.value); setErr('') }}
              disabled={readOnlyForSales}>
              {targetStages.map(st => (
                <option key={st.id} value={st.id}>
                  {st.name_ar}{(st.board ?? 'sales') !== currentBoard ? ' ← تحويل للمنسقة' : ''}
                </option>
              ))}
            </select>
            {!readOnlyForSales && (
              <button className="btn btn-primary"
                disabled={Number(stageTo) === lead.stage_id}
                onClick={changeStage}>نقل</button>
            )}
          </div>

          {needsLostReason && (
            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
              <label>سبب الخسارة *</label>
              <select value={lostReason} onChange={e => setLostReason(e.target.value)}>
                <option value="">— اختر —</option>
                {refs.lostReasons.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}
              </select>
            </div>
          )}

          {movingToFollowup && (
            <div style={{ marginTop: 10 }}>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>المنسقة المسؤولة *</label>
                <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}>
                  <option value="">— اختر —</option>
                  {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
              {!lead.offer_details?.trim() && (
                <p style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 700, lineHeight: 1.7 }}>
                  ⚠ سجّل العرض المقدّم أعلاه أولًا — التحويل لن يتم بدونه
                </p>
              )}
            </div>
          )}

          {lead.stages?.code === STAGE.DEAL && (
            <a href={`/deals?lead=${lead.id}`} className="btn btn-primary"
              style={{ display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>
              فتح ملف التعاقد ←
            </a>
          )}
        </div>

        {/* المتابعة */}
        <TaskSection leadId={leadId} leadOwnerId={lead.owner_id}
          onChanged={() => { const st = lead.stage_id; load(); emitBoardPatch({ refetch: [st] }); onChanged() }} />

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

        </>)}

        {tab === 'log' && (
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
        )}

        {/* منطقة الخطر — للمدير العام فقط (خارج التبويبات) */}
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
