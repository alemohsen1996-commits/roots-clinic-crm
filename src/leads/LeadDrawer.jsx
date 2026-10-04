// اللوحة الجانبية لتفاصيل الليد — تبويبان: «الكل» (كل الأفعال) + «السجل»
// الهيدر ثابت فوق التبويبين، وبه تعديل بيانات العميل الشامل inline
import { useEffect, useState, useCallback } from 'react'
import { salesLabel, assignableGroups } from '../lib/people'
import { supabase } from '../lib/supabase'
import { STAGE } from '../lib/stageCodes'
import { useAuth } from '../auth/AuthContext'
import { fmtClock, fmtDateTime, fmtNum, openWhatsApp } from '../lib/format'
import { emitBoardPatch } from './boardBus'
import TaskSection from './TaskSection'
import LeadCalls from '../calls/LeadCalls'
import useT from '../i18n/useT'
import i18n from '../i18n'
import { dbErr } from '../lib/dbErrors'
import { activityText } from '../lib/activityText'
import { useNavigate } from 'react-router-dom'
import LeadDiscussions from '../chat/LeadDiscussions'
import WaTemplatesMenu from '../chat/WaTemplatesMenu'
import { startDirect, errText as chatErr } from '../chat/chatApi'

// أسماء أنواع السجل في الترجمة: activity.*
const ACTIVITY_TYPES = ['call', 'note', 'whatsapp', 'sms', 'email', 'stage_change', 'assignment', 'system', 'offer']

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
  const { t, dn, isRtl } = useT()
  const navigate = useNavigate()
  const [discussCount, setDiscussCount] = useState(null)
  const [lead, setLead] = useState(null)
  const [acts, setActs] = useState([])
  const [openTask, setOpenTask] = useState(null)
  const [note, setNote] = useState('')
  const [noteType, setNoteType] = useState('note')
  const [stageTo, setStageTo] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [coordinatorId, setCoordinatorId] = useState('')
  // حجز معاينة عند التحويل للمتابعة
  const [apptNoTime, setApptNoTime] = useState(false)   // بدون موعد — المنسقة تحجز
  const [apptBranch, setApptBranch] = useState('')
  const [apptDate, setApptDate]     = useState('')
  const [apptTime, setApptTime]     = useState('')
  const [slots, setSlots]           = useState([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [coordinators, setCoordinators] = useState([])
  const [branches, setBranches] = useState([])
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [undo, setUndo] = useState(null)          // { fromStage, toStage } — تراجع سريع بعد نقل سريع
  const [busy, setBusy] = useState(false)

  const [tab, setTab] = useState('all')           // all | log | calls

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
  const [callsCount, setCallsCount] = useState(null)   // عدد مكالمات السنترال (للتبويب)

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
  const [offer, setOffer] = useState({ offered_price: '', offered_price_max: '', offer_details: '' })
  const [savingOffer, setSavingOffer] = useState(false)
  const [offerMsg, setOfferMsg] = useState(null)   // { ok, text } — تظهر بجوار الزر
  const [offerDirty, setOfferDirty] = useState(false)
  const [editingOffer, setEditingOffer] = useState(false)

  const load = useCallback(async () => {
    const [{ data: l }, { data: a }, { data: t }] = await Promise.all([
      supabase.from('leads')
        .select('*, stages(code, name_ar, name_en, color, category, board), lead_sources(name_ar, name_en), owner:profiles!leads_owner_id_fkey(full_name), coordinator:profiles!leads_coordinator_id_fkey(full_name), branches(name, name_en)')
        .eq('id', leadId).single(),
      supabase.from('activities')
        .select('*, profiles(full_name), f:stages!activities_from_stage_fkey(name_ar, name_en), t:stages!activities_to_stage_fkey(name_ar, name_en)')
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
    setApptBranch(l?.branch_id ? String(l.branch_id) : '')
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
      offered_price_max: l?.offered_price_max ?? '',
      offer_details: l?.offer_details ?? '',
    })
  }, [leadId])

  useEffect(() => { load() }, [load])

  // الخانات المتاحة لفرع/يوم المعاينة (تُولّد في القاعدة وتستبعد المحجوز)
  const loadSlots = useCallback(async () => {
    if (!apptBranch || !apptDate) { setSlots([]); return }
    setSlotsLoading(true)
    const { data } = await supabase.rpc('available_slots', {
      p_branch_id: Number(apptBranch), p_date: apptDate,
    })
    setSlots((data ?? []).map(r => r.slot))
    setSlotsLoading(false)
  }, [apptBranch, apptDate])


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
    supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('name')
      .then(({ data }) => setBranches(data ?? []))
  }, [])

  const currentBoard = lead?.stages?.board ?? 'sales'
  const isSalesOwner = roleCode === 'agent' && lead?.owner_id === profile?.id
  const readOnlyForSales = isSalesOwner && currentBoard === 'coordinator'
  // السيلز صاحب الليد والمديرين يقدروا يصحّحوا التحويل (المنسقة/الفرع/الموعد) طول ما الليد لسه في المتابعة
  const canFixHandoff = (isSalesOwner || isManager) && lead?.stages?.code === STAGE.FOLLOWUP
  // المدير يغيّر المنسقة في أي مرحلة بعد المتابعة (معاينة/ديل/تمت…) — الليد + الديل النشط + المعاينة النشطة
  const canManagerSwapCoord = isManager && currentBoard === 'coordinator' && lead?.stages?.code !== STAGE.FOLLOWUP

  // تحميل المعاينة النشطة لتعبئة نموذج التصحيح بالفرع/الموعد الحاليين
  useEffect(() => {
    if (!canFixHandoff) return
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('appointments')
        .select('id, branch_id, appt_date, appt_time, status')
        .eq('lead_id', leadId).in('status', ['pending', 'booked'])
        .order('id', { ascending: false }).limit(1).maybeSingle()
      if (!alive) return
      setApptBranch(data?.branch_id ? String(data.branch_id) : '')
      setApptNoTime(!data || data.status === 'pending')
      setApptDate(data?.appt_date ?? '')
      setApptTime('')
    })()
    return () => { alive = false }
  }, [canFixHandoff, leadId])

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
  // مراحل تُبقي المعاينة (المتابعة + حضر/لم يحضر المعاينة)؛ غيرها يلغي المعاينة
  const attendedStage = refs.stages.find(s => s.name_ar === 'حضر المعاينة')
  const noShowStage   = refs.stages.find(s => s.name_ar === 'لم يحضر المعاينة')

  // تحميل الخانات المتاحة عند تفعيل التحويل للمتابعة (بعد تعريف movingToFollowup)
  useEffect(() => {
    if ((!movingToFollowup && !canFixHandoff) || apptNoTime) { setSlots([]); return }
    loadSlots()
  }, [movingToFollowup, canFixHandoff, apptNoTime, loadSlots])

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
    say(t('drawer.undone'))
  }

  async function changeStage() {
    if (Number(stageTo) === lead.stage_id) return
    if (needsLostReason && !lostReason) { setErr(t('drawer.err.lostReason')); return }
    if (movingToFollowup && !coordinatorId) { setErr(t('drawer.err.coordBeforeFollowup')); return }
    // المنسقة تستلم العميل بناءً على العرض — التحويل بدونه يفقدها السياق
    if (movingToFollowup && !lead.offer_details?.trim()) {
      setErr(t('drawer.err.offerFirst'))
      return
    }
    if (movingToFollowup && !(lead.offered_price > 0)) {
      setErr(t('drawer.err.priceFirst'))
      return
    }
    if (movingToFollowup) {
      if (!apptBranch) { setErr(t('drawer.err.apptBranch')); return }
      if (!apptNoTime && (!apptDate || !apptTime)) {
        setErr(t('drawer.err.apptDayTime')); return
      }
    }

    // إرجاع من بورد المنسقات إلى المبيعات — قرار مؤثّر، نطلب تأكيدًا
    const backToSales = currentBoard === 'coordinator'
      && (targetStage?.board ?? 'sales') === 'sales'
    if (backToSales) {
      const ok = window.confirm(
        t('drawer.backToSalesConfirm', { name: lead.full_name })
      )
      if (!ok) return
    }

    setErr('')
    const fromStage = lead.stage_id      // نلتقطه قبل التحديث — بعد load() يصير المرحلة الجديدة
    const toStage = Number(stageTo)

    // للمتابعة: نحجز المعاينة أولًا (تقفل الخانة)، فإن نجحت ننقل الليد
    let createdApptId = null
    if (movingToFollowup) {
      const { data: appt, error: apptErr } = await supabase.from('appointments').insert({
        lead_id: leadId,
        branch_id: Number(apptBranch),
        coordinator_id: coordinatorId,
        created_by: profile.id,
        ...(apptNoTime
          ? { status: 'pending' }
          : { status: 'booked', appt_date: apptDate, appt_time: apptTime }),
      }).select('id').single()
      if (apptErr) {
        const conflict = apptErr.code === '23505'
        setErr(conflict ? t('drawer.err.slotTaken') : t('drawer.err.bookFailed'))
        if (conflict) { setApptTime(''); loadSlots() }
        return   // لم ننقل الليد
      }
      createdApptId = appt.id
    }

    const { error } = await supabase.from('leads').update({
      stage_id: toStage,
      ...(needsLostReason && { lost_reason_id: Number(lostReason) }),
      ...(movingToFollowup && { coordinator_id: coordinatorId }),
    }).eq('id', leadId)
    if (error) {
      if (createdApptId) await supabase.from('appointments').delete().eq('id', createdApptId)
      setErr(error.message?.includes('غير مصرح')
        ? t('drawer.err.backToSalesManagerOnly')
        : error.message?.includes('ديل تعاقد')
          ? t('drawer.err.needDeal')
          : error.message?.includes('المستقبل')
            ? t('drawer.err.futureOp')
            : t('drawer.err.stageFailed'))
      return
    }
    // بعد نجاح النقل: ألغِ أي معاينة نشطة سابقة لنفس الليد (يبقى موعد واحد فعّال)
    if (createdApptId) {
      await supabase.from('appointments')
        .update({ status: 'rescheduled', appt_date: null, appt_time: null, updated_at: new Date().toISOString() })
        .eq('lead_id', leadId).in('status', ['pending', 'booked']).neq('id', createdApptId)
    }
    // خروج من مسار المعاينة (أي مرحلة غير المتابعة أو حضر/لم يحضر المعاينة) — ألغِ أي معاينة نشطة
    const keepsAppt = targetStage?.code === STAGE.FOLLOWUP
      || (attendedStage && targetStage?.id === attendedStage.id)
      || (noShowStage && targetStage?.id === noShowStage.id)
    if (!movingToFollowup && !keepsAppt) {
      // العودة لبورد المبيعات (أدمن): خروج كامل من المسار — ألغِ أي معاينة (بدون موعد أو محجوزة)
      // التقدّم لمرحلة تالية (ديل/عملية/خسارة…): شِل «بدون موعد» من قائمة الانتظار فقط — واترك المحجوزة على الجدول
      const statuses = backToSales ? ['pending', 'booked'] : ['pending']
      await supabase.from('appointments')
        .update({ status: 'rescheduled', appt_date: null, appt_time: null, updated_at: new Date().toISOString() })
        .eq('lead_id', leadId).in('status', statuses)
    }
    await load()
    // نقل موضعي: العمود المصدر يشيله فورًا، والهدف يحدّث نفسه فقط
    emitBoardPatch({ removeId: leadId, removeFrom: fromStage, refetch: [toStage] })
    onChanged()
  }

  // تصحيح التحويل من السيلز — يغيّر المنسقة/الفرع/الموعد والليد لسه في المتابعة
  async function fixHandoff() {
    setErr('')
    if (!coordinatorId) { setErr(t('drawer.err.pickCoord')); return }
    if (!apptBranch) { setErr(t('drawer.err.apptBranch')); return }
    if (!apptNoTime && (!apptDate || !apptTime)) {
      setErr(t('drawer.err.apptDayTime')); return
    }
    setBusy(true)

    // 1) أنشئ المعاينة الجديدة أولًا (تقفل الخانة) — فإن نجحت نلغي القديمة
    const { data: appt, error: apptErr } = await supabase.from('appointments').insert({
      lead_id: leadId,
      branch_id: Number(apptBranch),
      coordinator_id: coordinatorId,
      created_by: profile.id,
      ...(apptNoTime
        ? { status: 'pending' }
        : { status: 'booked', appt_date: apptDate, appt_time: apptTime }),
    }).select('id').single()
    if (apptErr) {
      setBusy(false)
      const conflict = apptErr.code === '23505'
      setErr(conflict ? t('drawer.err.slotTaken') : t('drawer.err.apptEditFailed'))
      if (conflict) { setApptTime(''); loadSlots() }
      return
    }

    // 2) ألغِ أي معاينة نشطة سابقة (يبقى موعد واحد فعّال)
    await supabase.from('appointments')
      .update({ status: 'rescheduled', appt_date: null, appt_time: null, updated_at: new Date().toISOString() })
      .eq('lead_id', leadId).in('status', ['pending', 'booked']).neq('id', appt.id)

    // 3) حدّث منسقة الليد (المرحلة تفضل متابعة — مفيش نقل بورد)
    const { error: leadErr } = await supabase.from('leads')
      .update({ coordinator_id: coordinatorId }).eq('id', leadId)
    setBusy(false)
    if (leadErr) { setErr(t('drawer.err.coordUpdateFailed')); return }

    say(t('drawer.handoffFixed'))
    await load(); onChanged()
  }

  // تغيير المنسقة من المدير بعد مرحلة المتابعة
  async function swapCoordinator() {
    setErr('')
    if (!coordinatorId) { setErr(t('drawer.err.pickCoord')); return }
    if (coordinatorId === lead?.coordinator_id) { setErr(t('drawer.err.sameCoord')); return }
    setBusy(true)
    const { error: leadErr } = await supabase.from('leads')
      .update({ coordinator_id: coordinatorId }).eq('id', leadId)
    if (leadErr) { setBusy(false); setErr(t('drawer.err.coordChangeFailed')); return }
    // الديل النشط أو في الانتظار يتبع المنسقة الجديدة (العمولة بتتحسب على منسقة الديل)
    const { error: dealErr } = await supabase.from('deals')
      .update({ coordinator_id: coordinatorId })
      .eq('lead_id', leadId).in('status', ['active', 'waiting'])
    // المعاينة اللي لسه مفتوحة تتبعها كمان
    await supabase.from('appointments')
      .update({ coordinator_id: coordinatorId, updated_at: new Date().toISOString() })
      .eq('lead_id', leadId).in('status', ['pending', 'booked'])
    setBusy(false)
    if (dealErr) { setErr(t('drawer.err.coordChangedDealFailed')); }
    else say(t('drawer.coordChanged'))
    await load(); onChanged()
  }

  async function saveEdit() {
    if (!edit.full_name.trim() || !edit.phone.trim()) { setErr(t('addLead.required')); return }
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
        ? t('drawer.err.phoneTakenOther')
        : t('drawer.err.editFailed'))
      return
    }
    setEditing(false)
    await load()
    // الاسم/الرقم يظهران على الكارت — حدّث عمود هذا الليد فقط
    emitBoardPatch({ refetch: [st] })
    onChanged()
  }

  async function saveOffer() {
    const minP = offer.offered_price ? Number(offer.offered_price) : null
    const maxRaw = offer.offered_price_max ? Number(offer.offered_price_max) : null
    if (maxRaw != null && minP == null) {
      setOfferMsg({ ok: false, text: t('drawer.err.priceFromFirst') }); return
    }
    if (maxRaw != null && maxRaw < minP) {
      setOfferMsg({ ok: false, text: t('drawer.err.priceToGreater') }); return
    }
    // "إلى" نفس "من" = سعر واحد
    const maxP = maxRaw != null && maxRaw > minP ? maxRaw : null

    setSavingOffer(true); setOfferMsg(null)
    const { error } = await supabase.from('leads').update({
      offered_price: minP,
      offered_price_max: maxP,
      offer_details: offer.offer_details.trim() || null,
    }).eq('id', leadId)
    setSavingOffer(false)

    if (error) {
      setOfferMsg({ ok: false, text: t('addLead.saveFailed') + ' — ' + (dbErr(error.message || '')) })
      return
    }

    // سجل مفصّل: من كم إلى كم — يظهر في تبويب "العروض"
    const oldTxt = priceText(lead.offered_price, lead.offered_price_max)
    const newTxt = priceText(minP, maxP)
    const priceLine = oldTxt && newTxt && oldTxt !== newTxt
      ? `تعديل السعر من ${oldTxt} إلى ${newTxt}`
      : newTxt
        ? `السعر: ${newTxt}`
        : 'بدون سعر'

    await supabase.from('activities').insert({
      lead_id: leadId, user_id: profile.id, type: 'offer',
      content: `${priceLine}\n${offer.offer_details.trim()}`.trim(),
    })

    setOfferDirty(false)
    setEditingOffer(false)
    setOfferMsg({ ok: true, text: '✓ ' + t('drawer.offerSaved') })
    setTimeout(() => setOfferMsg(null), 4000)
    // العرض لا يظهر على كارت الكانبان — لا داعي لتحديث أي عمود
    await load(); onChanged()
  }

  function cancelOfferEdit() {
    setOffer({
      offered_price: lead?.offered_price ?? '',
      offered_price_max: lead?.offered_price_max ?? '',
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
      say(t('drawer.noAnswerMoved'), { fromStage, toStage: nextStageId })
    } else {
      emitBoardPatch({ refetch: [fromStage] })
      say(t('drawer.noAnswerLogged'))
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
      say(t('drawer.contactedMoved'), { fromStage, toStage: contacted.id })
    } else {
      emitBoardPatch({ refetch: [fromStage] })
      say(t('drawer.contactedLogged'))
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
      say(t('drawer.interestedLogged'), { fromStage, toStage: interested.id })
    } else {
      emitBoardPatch({ refetch: [fromStage] })
      say(t('drawer.interestedLogged'))
    }
    onChanged()
  }

  // إجراء سريع: غير مهتم — ينقل لمرحلة "غير مهتم" (dead) مع سبب اختياري
  async function markNotInterested() {
    const dead = refs.stages.find(s => s.code === STAGE.DEAD)
    if (!dead) { setErr(t('drawer.err.noDeadStage')); return }
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
    say(t('drawer.notInterestedLogged'), { fromStage, toStage: dead.id })
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
    if (error) { setErr(t('drawer.err.archiveFailed')); return }
    emitBoardPatch({ removeId: leadId, removeFrom: st })
    onChanged(); onClose()
  }

  async function deleteLeadPermanent() {
    const st = lead.stage_id
    const { error } = await supabase.rpc('delete_lead_permanent', { p_lead_id: leadId })
    if (error) { setErr(t('drawer.err.deleteFailed')); return }
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
              <a className="icon-btn" href={`tel:${lead.phone}`} title={t('lead.call')}>☎</a>
              <button className="icon-btn" title="WhatsApp"
                            onClick={() => openWhatsApp(lead.phone)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 0 16.47Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.19 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z"/>
                </svg>
              </button>
              <WaTemplatesMenu lead={lead} />
              <button className="icon-btn" title={t('lead.copyPhone')}
                onClick={() => { navigator.clipboard?.writeText(lead.phone ?? ''); say(t('lead.phoneCopied')) }}>⧉</button>
              {(() => {
                // «ناقش مع»: السيلز ↔ المنسقة؛ المدير بيكلّم السيلز
                const target = lead.owner_id === profile?.id ? lead.coordinator_id
                  : lead.coordinator_id === profile?.id ? lead.owner_id : (lead.owner_id ?? lead.coordinator_id)
                if (!target || target === profile?.id) return null
                const isCoord = target === lead.coordinator_id && target !== lead.owner_id
                return (
                  <button className="btn btn-ghost btn-sm" style={{ marginInlineStart: 4 }}
                    title={isCoord ? t('chat.askCoordinator') : t('chat.askSales')}
                    onClick={async () => {
                      try { const id = await startDirect(target); navigate(`/chat?c=${id}&lead=${leadId}`); onClose?.() }
                      catch (e) { setErr(chatErr(e)) }
                    }}>
                    💬 {isCoord ? t('chat.askCoordinator') : t('chat.askSales')}
                  </button>
                )
              })()}
            </div>

            {/* الحالة الحالية */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className="badge stage-pill" style={{ '--stage': lead.stages?.color ?? '#888' }}>
                {dn(lead.stages)}
              </span>
              {paused ? (
                <span className="badge badge-suspended">⏹ {t('drawer.pausedBadge')}</span>
              ) : openTask ? (
                <span className="badge" style={{
                  background: taskLate ? 'var(--danger-soft)' : 'var(--primary)' + '18',
                  color: taskLate ? 'var(--danger)' : 'var(--primary)',
                  fontWeight: 700,
                }}>
                  {taskLate ? '⚠' : '⏰'} {fmtDateTime(openTask.due_at)}
                </span>
              ) : (
                <span className="badge badge-pending">{t('drawer.noFollowup')}</span>
              )}
              {lead.attempts > 0 && (
                <span className="badge" style={{ background: 'var(--surface)', color: 'var(--ink-soft)' }}>
                  {t('kanban.attempts', { n: lead.attempts })}
                </span>
              )}
              {lead.offered_price > 0 && (
                <span className="badge" style={{ background: 'var(--gold-soft)', color: 'var(--gold)' }}>
                  {priceText(lead.offered_price, lead.offered_price_max)}
                </span>
              )}
            </div>

            {/* بيانات العميل — ملخّص مضغوط + قلم (فورم التعديل الكامل يظهر بعرض الدرور تحت الرأس) */}
            {!editing && (
              <div>
                <div className="lead-facts">
                  <span><i>{t('lead.age')}</i>{lead.age ?? '—'}</span>
                  <span><i>{t('lead.job')}</i>{lead.occupation ?? '—'}</span>
                  <span><i>{t('lead.city')}</i>{lead.city ?? '—'}</span>
                  <span><i>{t('lead.branch')}</i>{dn(lead.branches) || '—'}</span>
                  <span><i>{t('lead.source')}</i>{dn(lead.lead_sources) || '—'}</span>
                  <span><i>{t('lead.interest')}</i>{lead.procedure_interest ? t(`interest.${lead.procedure_interest}`, { defaultValue: lead.procedure_interest }) : '—'}</span>
                  <span><i>{t('lead.owner')}</i>{lead.owner?.full_name ?? t('lead.unassigned')}</span>
                  {lead.coordinator?.full_name && (
                    <span><i>{t('lead.coordShort')}</i>{lead.coordinator.full_name}</span>
                  )}
                </div>
                {!readOnlyForSales && (
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, marginTop: 6 }}
                    onClick={() => { setEditing(true); setErr('') }}>
                    ✎ {t('drawer.editData')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="head-actions">
            {hasNav && (
              <div className="nav-pager" title={t('drawer.navHint')}>
                <button className="icon-btn" disabled={!prevLead}
                  onClick={() => goTo(prevLead)} title={t('drawer.prev')}>{isRtl ? '→' : '←'}</button>
                <span className="nav-pos">{navIndex + 1} / {navList.length}</span>
                <button className="icon-btn" disabled={!nextLead}
                  onClick={() => goTo(nextLead)} title={t('drawer.next')}>{isRtl ? '←' : '→'}</button>
              </div>
            )}
            <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          </div>
        </header>

        {err && <div className="alert alert-error">{err}</div>}
        {flash && (
          <div className="alert alert-ok"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>{flash}</span>
            {undo && (
              <button className="btn btn-ghost" style={{ padding: '4px 12px' }} onClick={undoMove}>
                ↩ {t('common.undo')}
              </button>
            )}
          </div>
        )}

        {readOnlyForSales && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)',
            background: 'var(--surface)', padding: '8px 12px', borderRadius: 8, marginBottom: 10 }}>
            👁 {t('drawer.readOnlyNote')}
          </div>
        )}

        {canFixHandoff && (
          <div className="stage-box" style={{ border: '1.5px solid var(--primary)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div className="row-label" style={{ color: 'var(--primary)' }}>{t('drawer.fixHandoff')}</div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 10px', lineHeight: 1.7 }}>
              {t('drawer.fixHandoffHint')}
            </p>

            <div className="field" style={{ marginBottom: 6 }}>
              <label>{t('lead.coordinator')} *</label>
              <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}>
                <option value="">{t('common.pick')}</option>
                {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>

            <div className="field" style={{ marginBottom: 6 }}>
              <label>{t('drawer.apptBranch')} *</label>
              <select value={apptBranch} onChange={e => { setApptBranch(e.target.value); setApptTime('') }}>
                <option value="">{t('common.pick')}</option>
                {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
              <input type="checkbox" checked={apptNoTime}
                onChange={e => { setApptNoTime(e.target.checked); setApptTime('') }} />
              {t('drawer.noApptTime')}
            </label>

            {!apptNoTime && (
              <>
                <div className="field" style={{ marginBottom: 6 }}>
                  <label>{t('drawer.apptDay')} *</label>
                  <input type="date" value={apptDate}
                    onChange={e => { setApptDate(e.target.value); setApptTime('') }} />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>{t('drawer.apptTime')} *</label>
                  {(!apptBranch || !apptDate) ? (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t('drawer.pickBranchDay')}</div>
                  ) : slotsLoading ? (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t('common.loading')}</div>
                  ) : slots.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>
                      {t('drawer.noSlots')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {slots.map(tm => {
                        const on = apptTime === tm
                        return (
                          <button key={tm} type="button" onClick={() => setApptTime(tm)} className="btn"
                            style={{ padding: '5px 12px', fontSize: 13, borderRadius: 8,
                              border: '1px solid ' + (on ? 'var(--primary)' : 'var(--line)'),
                              background: on ? 'var(--primary)' : 'transparent', color: on ? '#fff' : 'var(--ink)' }}>
                            {fmtClock(tm)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            <button className="btn btn-primary" disabled={busy} onClick={fixHandoff}>
              {busy ? '…' : t('drawer.fixHandoff')}
            </button>
          </div>
        )}

        {canManagerSwapCoord && (
          <div className="stage-box" style={{ border: '1.5px solid var(--primary)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <div className="row-label" style={{ color: 'var(--primary)' }}>{t('drawer.swapCoord')}</div>
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '0 0 10px', lineHeight: 1.7 }}>
              {t('drawer.swapCoordHint')}
            </p>
            <div className="field" style={{ marginBottom: 8 }}>
              <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}>
                <option value="">{t('common.pick')}</option>
                {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" disabled={busy || !coordinatorId || coordinatorId === lead?.coordinator_id}
              onClick={swapCoordinator}>
              {busy ? '…' : t('drawer.saveCoord')}
            </button>
          </div>
        )}

        {editing && (
          <div className="lead-edit">
            <div className="lead-edit-title">✎ {t('drawer.editClient')}</div>

            <div className="lead-edit-group">
              <div className="grp-label">{t('drawer.grpBasic')}</div>
              <div className="lead-edit-grid">
                <div className="field">
                  <label>{t('lead.name')} *</label>
                  <input value={edit.full_name} onChange={e => setE('full_name', e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('lead.phone')} *</label>
                  <input dir="ltr" value={edit.phone} onChange={e => setE('phone', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="lead-edit-group">
              <div className="grp-label">{t('drawer.grpPersonal')}</div>
              <div className="lead-edit-grid">
                <div className="field">
                  <label>{t('lead.age')}</label>
                  <input type="number" min={0} max={120} value={edit.age}
                    onChange={e => setE('age', e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('lead.job')}</label>
                  <input value={edit.occupation} onChange={e => setE('occupation', e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('lead.city')}</label>
                  <input value={edit.city} onChange={e => setE('city', e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('lead.country')}</label>
                  <input value={edit.country} onChange={e => setE('country', e.target.value)} />
                </div>
                <div className="field col-2">
                  <label>{t('lead.language')}</label>
                  <input value={edit.language} onChange={e => setE('language', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="lead-edit-group">
              <div className="grp-label">{t('drawer.grpClassify')}</div>
              <div className="lead-edit-grid">
                <div className="field">
                  <label>{t('lead.source')}</label>
                  <select value={edit.source_id} onChange={e => setE('source_id', e.target.value)}>
                    <option value="">{t('common.noneDash')}</option>
                    {refs.sources.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>{t('lead.branch')}</label>
                  <select value={edit.branch_id} onChange={e => setE('branch_id', e.target.value)}>
                    <option value="">{t('common.noneDash')}</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>{t('lead.interest')}</label>
                  <input value={edit.procedure_interest}
                    onChange={e => setE('procedure_interest', e.target.value)} />
                </div>
                <div className="field">
                  <label>{t('lead.budget')}</label>
                  <input value={edit.budget_range} onChange={e => setE('budget_range', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="lead-edit-group">
              <div className="grp-label">{t('lead.notes')}</div>
              <div className="lead-edit-grid">
                <div className="field col-2">
                  <textarea rows={2} value={edit.notes}
                    onChange={e => setE('notes', e.target.value)}
                    placeholder={t('drawer.notesPh')} />
                </div>
              </div>
            </div>

            <div className="lead-edit-actions">
              <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? t('common.saving') : t('common.save')}
              </button>
              <button className="btn btn-ghost" onClick={() => { setEditing(false); setErr(''); load() }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* ===== التبويبات: الكل | السجل | متصل ===== */}
        <div className="tabs drawer-tabs">
          {[
            { k: 'all', l: t('common.all') },
            { k: 'log', l: t('drawer.log') },
            { k: 'calls', l: `📞 ${t('drawer.called')}${callsCount ? ` (${callsCount})` : ''}` },
            { k: 'chat', l: `💬 ${t('chat.leadDiscussions')}${discussCount ? ` (${discussCount})` : ''}` },
          ].map(tb => (
            <button key={tb.k} className={'tab' + (tab === tb.k ? ' on' : '')}
              onClick={() => setTab(tb.k)}>{tb.l}</button>
          ))}
        </div>

        {/* متصل — مكالمات السنترال: متحمّلة دايمًا (عشان العدد في التبويب) وبتظهر في تبويبها بس */}
        <div className="drawer-section" style={{ display: tab === 'calls' ? 'block' : 'none' }}>
          <h3>{t('drawer.called')}</h3>
          <div className="timeline-scroll">
            <LeadCalls leadId={leadId} onCount={setCallsCount} />
            {callsCount === 0 && <div className="empty" style={{ padding: 20 }}>{t('drawer.noPbxCalls')}</div>}
          </div>
        </div>

        {tab === 'chat' && (
          <div className="drawer-section">
            <h3>{t('chat.leadDiscussions')}</h3>
            <LeadDiscussions leadId={leadId} meId={profile?.id} onCount={setDiscussCount}
              onOpen={(convId) => { navigate(`/chat?c=${convId}`); onClose?.() }} />
          </div>
        )}

        {tab === 'all' && (<>

        {/* تسجيل نشاط + أزرار النتيجة السريعة */}
        {!readOnlyForSales && (
          <div className="act-box">
            <div className="row-label">{t('drawer.whatHappened')}</div>

            {currentBoard === 'sales' && (
              <div className="quick-acts">
                <button className="act-chip no" disabled={busy} onClick={markNoAnswer}
                  title={(() => {
                    const chain = buildNoAnswerChain(refs.stages)
                    const i = chain.findIndex(x => x.code === lead.stages?.code)
                    if (!chain.length) return t('drawer.logsAttempt')
                    if (i === -1) return t('drawer.movesTo', { stage: dn(chain[0]) })
                    if (i < chain.length - 1) return t('drawer.movesTo', { stage: dn(chain[i + 1]) })
                    return t('drawer.lastStageCounter')
                  })()}>
                  ☎ {t('drawer.noAnswer')}
                </button>
                <button className="act-chip yes" disabled={busy} onClick={markContacted}>
                  ✓ {t('drawer.contacted')}
                </button>
                <button className="act-chip" disabled={busy} onClick={markInterested}
                  style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>
                  ♥ {t('drawer.interested')}
                </button>
                <button className="act-chip" disabled={busy}
                  onClick={() => { setNotInterestedOpen(v => !v); setErr('') }}
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                  ✕ {t('drawer.notInterested')}
                </button>
              </div>
            )}

            {/* غير مهتم: سبب سريع قبل النقل لمرحلة الخسارة */}
            {currentBoard === 'sales' && notInterestedOpen && (
              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                <label>{t('drawer.notInterestedReason')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={notInterestedReason}
                    onChange={e => setNotInterestedReason(e.target.value)} style={{ flex: 1 }}>
                    <option value="">{t('drawer.noReason')}</option>
                    {refs.lostReasons.map(r => <option key={r.id} value={r.id}>{dn(r)}</option>)}
                  </select>
                  <button className="btn btn-danger" disabled={busy} onClick={markNotInterested}>
                    {t('common.confirm')}
                  </button>
                </div>
              </div>
            )}

            <div className="note-row">
              <input className="note-input" value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addActivity()}
                placeholder={t('drawer.notePh')} />
              <select className="note-type" value={noteType} onChange={e => setNoteType(e.target.value)}>
                <option value="note">{t('activity.note')}</option>
                <option value="call">{t('activity.call')}</option>
                <option value="whatsapp">{t('activity.whatsapp')}</option>
              </select>
              <button className="btn btn-primary" onClick={addActivity} disabled={!note.trim()}>
                {t('common.save')}
              </button>
            </div>
          </div>
        )}

        {/* العرض المقدّم — ارتفاع ثابت مع اسكرول */}
        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{t('drawer.offerTitle')}</h3>
            {!editingOffer && !readOnlyForSales && hasOffer && (
              <button className="btn btn-ghost" style={{ padding: '6px 14px' }}
                onClick={() => { setEditingOffer(true); setOfferMsg(null) }}>
                {t('common.edit')}
              </button>
            )}
          </div>

          {/* ---- وضع العرض (مقروء) — ارتفاع محدود + اسكرول ---- */}
          {(!editingOffer || readOnlyForSales) && hasOffer && (
            <div className="offer-box">
              <div className="offer-price">
                {lead.offered_price
                  ? priceText(lead.offered_price, lead.offered_price_max)
                  : t('drawer.priceNotSet')}
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
                  ⚠ {t('drawer.noOfferDetails')}
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
                {t('drawer.noOfferYet')}
              </div>
              <button className="btn btn-primary" onClick={() => setEditingOffer(true)}>
                {t('drawer.recordOffer')}
              </button>
            </div>
          )}
          {!hasOffer && readOnlyForSales && (
            <div className="offer-box" style={{ borderStyle: 'dashed' }}>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{t('drawer.noOffer')}</div>
            </div>
          )}

          {/* ---- وضع التحرير ---- */}
          {editingOffer && !readOnlyForSales && (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                {t('drawer.offerEditHint')}
              </p>
              <div className="field">
                <label>{t('drawer.offeredPriceLabel', { cur: t('common.currency') })}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" min={0} value={offer.offered_price} aria-label={t('leads.f.priceFrom')}
                    onChange={e => setO('offered_price', e.target.value)}
                    placeholder={t('drawer.priceFromPh')} style={{ flex: 1 }} />
                  <span style={{ color: 'var(--ink-soft)' }}>–</span>
                  <input type="number" min={0} value={offer.offered_price_max} aria-label={t('leads.f.priceTo')}
                    onChange={e => setO('offered_price_max', e.target.value)}
                    placeholder={t('drawer.priceToPh')} style={{ flex: 1 }} />
                </div>
              </div>
              <div className="field">
                <label>{t('drawer.offerDetailsLabel')}</label>
                <textarea rows={6} value={offer.offer_details}
                  onChange={e => setO('offer_details', e.target.value)}
                  placeholder={t('drawer.offerDetailsPh')}
                  style={{
                    width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)',
                    fontSize: 13.5, lineHeight: 1.9, resize: 'vertical',
                  }} />
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={saveOffer} disabled={savingOffer}>
                  {savingOffer ? t('common.saving') : t('drawer.saveOffer')}
                </button>
                <button className="btn btn-ghost" onClick={cancelOfferEdit}>{t('common.cancel')}</button>

                {offerMsg && !offerMsg.ok && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--danger)' }}>
                    {offerMsg.text}
                  </span>
                )}
                {!offerMsg && offerDirty && (
                  <span style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>
                    ● {t('drawer.unsaved')}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* نقل المرحلة — مباشرة تحت العرض */}
        <div className="stage-box">
          <div className="row-label">
            {t('drawer.moveStage')} · {currentBoard === 'coordinator' ? t('leads.coordBoard') : t('leads.salesBoard')}
          </div>

          <div className="stage-row">
            <select value={stageTo} onChange={e => { setStageTo(e.target.value); setErr('') }}
              disabled={readOnlyForSales}>
              {targetStages.map(st => (
                <option key={st.id} value={st.id}>
                  {dn(st)}{(st.board ?? 'sales') !== currentBoard ? ` ${isRtl ? '←' : '→'} ${t('drawer.transferToCoord')}` : ''}
                </option>
              ))}
            </select>
            {!readOnlyForSales && (
              <button className="btn btn-primary"
                disabled={Number(stageTo) === lead.stage_id}
                onClick={changeStage}>{t('drawer.move')}</button>
            )}
          </div>

          {needsLostReason && (
            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
              <label>{t('drawer.lostReason')} *</label>
              <select value={lostReason} onChange={e => setLostReason(e.target.value)}>
                <option value="">{t('common.pick')}</option>
                {refs.lostReasons.map(r => <option key={r.id} value={r.id}>{dn(r)}</option>)}
              </select>
            </div>
          )}

          {movingToFollowup && (
            <div style={{ marginTop: 10 }}>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>{t('lead.coordinator')} *</label>
                <select value={coordinatorId} onChange={e => setCoordinatorId(e.target.value)}>
                  <option value="">{t('common.pick')}</option>
                  {coordinators.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>

              <div className="field" style={{ marginBottom: 6 }}>
                <label>{t('drawer.apptBranch')} *</label>
                <select value={apptBranch}
                  onChange={e => { setApptBranch(e.target.value); setApptTime('') }}>
                  <option value="">{t('common.pick')}</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
                <input type="checkbox" checked={apptNoTime}
                  onChange={e => { setApptNoTime(e.target.checked); setApptTime('') }} />
                {t('drawer.noApptTime')}
              </label>

              {!apptNoTime && (
                <>
                  <div className="field" style={{ marginBottom: 6 }}>
                    <label>{t('drawer.apptDay')} *</label>
                    <input type="date" value={apptDate}
                      onChange={e => { setApptDate(e.target.value); setApptTime('') }} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>{t('drawer.apptTime')} *</label>
                    {(!apptBranch || !apptDate) ? (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t('drawer.pickBranchDay')}</div>
                    ) : slotsLoading ? (
                      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{t('common.loading')}</div>
                    ) : slots.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: 'var(--warn)', fontWeight: 600 }}>
                        {t('drawer.noSlots')}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {slots.map(tm => {
                          const on = apptTime === tm
                          return (
                            <button key={tm} type="button" onClick={() => setApptTime(tm)}
                              className="btn"
                              style={{
                                padding: '5px 12px', fontSize: 13, borderRadius: 8,
                                border: '1px solid ' + (on ? 'var(--primary)' : 'var(--line)'),
                                background: on ? 'var(--primary)' : 'transparent',
                                color: on ? '#fff' : 'var(--ink)',
                              }}>
                              {fmtClock(tm)}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
              {!lead.offer_details?.trim() && (
                <p style={{ fontSize: 12.5, color: 'var(--danger)', fontWeight: 700, lineHeight: 1.7 }}>
                  ⚠ {t('drawer.offerRequiredNote')}
                </p>
              )}
            </div>
          )}

          {lead.stages?.code === STAGE.DEAL && (
            <a href={`/deals?lead=${lead.id}`} className="btn btn-primary"
              style={{ display: 'inline-block', marginTop: 10, textDecoration: 'none' }}>
              {t('drawer.openDeal')} {isRtl ? '←' : '→'}
            </a>
          )}
        </div>

        {/* المتابعة */}
        <TaskSection leadId={leadId} leadOwnerId={lead.owner_id}
          onChanged={() => { const st = lead.stage_id; load(); emitBoardPatch({ refetch: [st] }); onChanged() }} />

        {/* إعادة الإسناد — للمديرين */}
        {isManager && (
          <div className="drawer-section">
            <h3>{t('drawer.reassign')}</h3>
            {(() => {
              const { sales, coordinators: coords } = assignableGroups(refs.agents)
              // المالك الحالي لو مش سيلز ولا منسقة (مثلًا مدير عام) — نعرضه عشان القائمة متبانش «Pool» غلط
              const known = lead.owner_id && [...sales, ...coords].some(a => a.id === lead.owner_id)
              const cur = !known && lead.owner_id ? refs.agents.find(a => a.id === lead.owner_id) : null
              return (
                <select value={lead.owner_id ?? ''} onChange={e => reassign(e.target.value || null)}>
                  <option value="">{t('lead.unassigned')} (Pool)</option>
                  {cur && <option value={cur.id}>{cur.full_name}</option>}
                  <optgroup label={t('roles.agent')}>
                    {sales.map(a => <option key={a.id} value={a.id}>{salesLabel(a)}</option>)}
                  </optgroup>
                  {coords.length > 0 && (
                    <optgroup label={t('roles.coordinator')}>
                      {coords.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                    </optgroup>
                  )}
                </select>
              )
            })()}
          </div>
        )}

        </>)}

        {tab === 'log' && (
        <div className="drawer-section">
          <h3>{t('drawer.log')}</h3>
          <div className="tabs" style={{ marginBottom: 10 }}>
            {[
              { k: 'all',  l: t('common.all') },
              { k: 'comm', l: t('drawer.logComm') },
              { k: 'note', l: t('drawer.logNotes') },
              { k: 'offer', l: t('drawer.logOffers') },
              { k: 'sys',  l: t('drawer.logChanges') },
            ].map(tb => (
              <button key={tb.k} className={'tab' + (actTab === tb.k ? ' on' : '')}
                onClick={() => setActTab(tb.k)}>{tb.l}</button>
            ))}
          </div>
          <div className="timeline timeline-scroll">
            {shownActs.length === 0 && <div className="empty" style={{ padding: 20 }}>{t('kanban.empty')}</div>}
            {shownActs.map(a => (
              <div className="timeline-item" key={a.id}>
                <div className="timeline-meta">
                  <b>{ACTIVITY_TYPES.includes(a.type) ? t(`activity.${a.type}`) : a.type}</b>
                  <span>{a.profiles?.full_name ?? t('activity.system')}</span>
                  <span>{fmtDateTime(a.created_at)}</span>
                </div>
                <div className="timeline-body">
                  {a.type === 'stage_change'
                    ? <>{t('drawer.from')} <b>{dn(a.f) || '—'}</b> {t('drawer.to')} <b>{dn(a.t) || '—'}</b></>
                    : <span style={{ whiteSpace: 'pre-wrap' }}>{activityText(a.content)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* منطقة الخطر — للمدير العام فقط (خارج التبويبات) */}
        {isManager && (
          <div className="drawer-section danger-zone">
            <h3 style={{ color: 'var(--danger)' }}>{t('drawer.dangerZone')}</h3>

            <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 10 }}
              onClick={archiveLead}>
              📦 {t('drawer.archiveLead')}
            </button>

            {!confirmDelete ? (
              <button className="btn btn-danger" style={{ width: '100%' }}
                onClick={() => setConfirmDelete(true)}>
                🗑 {t('drawer.deleteForever')}
              </button>
            ) : (
              <div style={{ border: '1px solid var(--danger)', borderRadius: 8, padding: 12 }}>
                <p style={{ fontSize: 12.5, color: 'var(--danger)', marginBottom: 8, fontWeight: 600 }}>
                  ⚠ {t('drawer.deleteWarn')}
                  {' '}{t('drawer.typeToConfirm')} <b>{t('drawer.deleteWord')}</b>:
                </p>
                <input value={deleteText} onChange={e => setDeleteText(e.target.value)}
                  placeholder={t('drawer.deleteWord')} style={{ marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-danger" disabled={deleteText.trim() !== t('drawer.deleteWord')}
                    onClick={deleteLeadPermanent}>{t('drawer.confirmDelete')}</button>
                  <button className="btn btn-ghost"
                    onClick={() => { setConfirmDelete(false); setDeleteText('') }}>{t('common.cancel')}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

// السعر المعروض: "5,000 ر.س" أو نطاق "5,000 – 8,000 ر.س"
function priceText(min, max) {
  const a = Number(min) || 0, b = Number(max) || 0
  if (!a) return ''
  const f = (x) => x.toLocaleString('en-US')
  const c = i18n.t('common.currency')
  return b > a ? `${f(a)} – ${f(b)} ${c}` : `${f(a)} ${c}`
}
