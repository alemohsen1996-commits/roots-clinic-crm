// طبقة البيانات للشات الداخلي — كل الكتابة عبر دوال القاعدة (RPC)
// عدا إرسال الرسالة: insert مباشر محمي بـ RLS (الطرف في المحادثة فقط)
import i18n from '../i18n'
import { dbErr } from '../lib/dbErrors'
import { supabase } from '../lib/supabase'

const MSG_COLS = 'id, conversation_id, sender_id, body, lead_id, lead_label, reply_to, created_at, edited_at, deleted_at, attachment_path, attachment_type, attachment_name, attachment_size, mentions'
export const PAGE = 50

const unwrap = ({ data, error }) => { if (error) throw error; return data }

export const fetchInbox = async () => unwrap(await supabase.rpc('chat_inbox')) ?? []

export const fetchMonitorList = async ({ userId = null, search = '' } = {}) =>
  unwrap(await supabase.rpc('chat_monitor_list', { p_user: userId, p_search: search || null })) ?? []

export const fetchUnreadTotal = async () => {
  const { data, error } = await supabase.rpc('chat_unread_total')
  return error ? 0 : (data ?? 0)
}

export const fetchConversation = async (id) =>
  unwrap(await supabase.from('chat_conversations')
    .select('id, kind, title, lead_id, created_by, created_at, announce, pinned_message_id').eq('id', id).single())

export const fetchParticipants = async (id) =>
  unwrap(await supabase.from('chat_participants')
    .select('user_id, is_admin, last_read_at, left_at, profiles(full_name, roles(code, name_ar, name_en))')
    .eq('conversation_id', id)) ?? []

// الأحدث أولًا من القاعدة، ونرجّعها بالترتيب الزمني للعرض
export async function fetchMessages(convId, before = null) {
  let q = supabase.from('chat_messages').select(MSG_COLS)
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false }).limit(PAGE)
  if (before) q = q.lt('created_at', before)
  const rows = unwrap(await q) ?? []
  return rows.reverse()
}

// سجل التعديل/الحذف — يرجع صفوف للمديرين فقط (RLS)، والباقي بياخد مصفوفة فاضية
export async function fetchHistory(messageIds) {
  if (!messageIds.length) return []
  const { data } = await supabase.from('chat_message_history')
    .select('message_id, action, old_body, at').in('message_id', messageIds).order('at')
  return data ?? []
}

// المعرّف بيتولد في المتصفح: الرسالة بتظهر فورًا، والحدث اللحظي لنفس الرسالة بيتطابق معاها
export const newMsgId = () =>
  crypto.randomUUID?.() ?? '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16))

export async function sendMessage({ id, convId, senderId, body, leadId = null, replyTo = null, attachment = null, mentions = [] }) {
  const { data, error } = await supabase.from('chat_messages')
    .insert({
      id, conversation_id: convId, sender_id: senderId, body: body || null, lead_id: leadId, reply_to: replyTo,
      mentions,
      ...(attachment ? {
        attachment_path: attachment.path, attachment_type: attachment.type,
        attachment_name: attachment.name, attachment_size: attachment.size,
      } : {}),
    })
    .select(MSG_COLS).single()
  // اتبعتت فعلًا في محاولة سابقة بس الرد ضاع
  if (error?.code === '23505') return fetchMessage(id)
  if (error) throw error
  return data
}

export const fetchMessage = async (id) =>
  unwrap(await supabase.from('chat_messages').select(MSG_COLS).eq('id', id).single())

export const editMessage   = async (id, body) => unwrap(await supabase.rpc('chat_edit_message', { p_id: id, p_body: body }))
export const deleteMessage = async (id) => unwrap(await supabase.rpc('chat_delete_message', { p_id: id }))
export const markRead      = async (convId) => { await supabase.rpc('chat_mark_read', { p_conv: convId }) }
export const logMonitorView = async (convId) => { await supabase.rpc('chat_log_view', { p_conv: convId }) }

export const startDirect = async (userId) => unwrap(await supabase.rpc('chat_start_direct', { p_user: userId }))
export const createGroup = async (title, members, leadId = null, announce = false) =>
  unwrap(await supabase.rpc('chat_create_group', { p_title: title, p_members: members, p_lead_id: leadId, p_announce: announce }))
export const pinMessage = async (convId, msgId) => unwrap(await supabase.rpc('chat_pin_message', { p_conv: convId, p_msg: msgId }))

// نقاشات ليد معيّن عبر كل المحادثات اللي الموظف شايفها
export const fetchLeadMessages = async (leadId) =>
  unwrap(await supabase.rpc('chat_lead_messages', { p_lead: leadId })) ?? []

// ---------- المرفقات (bucket chat-attachments — مجلد لكل موظف) ----------
const ATT_BUCKET = 'chat-attachments'
const ATT_MAX = 10 * 1024 * 1024
// ضغط الصور قبل الرفع: أقصى ضلع 1280px + WebP (أو JPEG لو المتصفح مش بيدعم) + هدف ≤ 300KB
// الصور بتتعاد ترميزها دايمًا (حتى الصغيرة) عشان تتشال بيانات EXIF والـ PNG الثقيلة بتتحول
const IMG_MAX_SIDE = 1280
const IMG_TARGET = 300 * 1024
const RE_ENCODABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff']

const toBlob = (canvas, type, q) => new Promise(res => canvas.toBlob(res, type, q))

async function shrinkImage(file) {
  if (!RE_ENCODABLE.includes(file.type)) return file   // GIF/SVG وغيرها زي ما هي
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, IMG_MAX_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)   // الشفافية بتبقى أبيض
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close?.()

    // WebP أصغر بـ ~30% من JPEG — ولو المتصفح رجّع نوع تاني نستخدم JPEG
    let type = 'image/webp', ext = 'webp'
    let blob = await toBlob(canvas, type, 0.78)
    if (!blob || blob.type !== 'image/webp') { type = 'image/jpeg'; ext = 'jpg'; blob = await toBlob(canvas, type, 0.8) }
    // لسه كبيرة؟ ننزل الجودة تدريجيًا لحد الهدف
    for (const q of [0.68, 0.58, 0.5]) {
      if (!blob || blob.size <= IMG_TARGET) break
      blob = await toBlob(canvas, type, q)
    }
    if (!blob) return file
    // الأصل أصغر من الناتج (نادر: صورة صغيرة أصلًا)؟ نسيب الأصل لو هو مش PNG ضخم
    if (blob.size >= file.size && file.type !== 'image/png') return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type })
  } catch { return file }
}

// بيرجّع { path, type, name, size } للإرسال مع الرسالة
export async function uploadAttachment(file, userId) {
  if (!file) throw new Error(i18n.t('chat.att.pickFile'))
  const ready = await shrinkImage(file)
  if (ready.size > ATT_MAX) throw new Error(i18n.t('chat.att.tooBig'))
  const isImage = ready.type.startsWith('image/')
  if (isImage && ready.size > 2 * 1024 * 1024) throw new Error(i18n.t('chat.att.imageTooBig'))
  const ext = (ready.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(ATT_BUCKET).upload(path, ready, { contentType: ready.type, upsert: false })
  if (error) throw new Error(i18n.t('chat.att.uploadFailed') + ' — ' + error.message)
  return { path, type: isImage ? 'image' : 'file', name: file.name, size: ready.size }
}

export const discardAttachment = (path) => { if (path) supabase.storage.from(ATT_BUCKET).remove([path]).catch(() => {}) }

// روابط موقّعة بكاش قصير — الصور بتتجاب بالعشرات في المحادثة الواحدة
const urlCache = new Map()
export async function attachmentUrl(path) {
  const hit = urlCache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from(ATT_BUCKET).createSignedUrl(path, 3600)
  if (error || !data?.signedUrl) return null
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}

// ---------- قوالب واتساب ----------
export const fetchWaTemplates = async () =>
  unwrap(await supabase.from('wa_templates').select('id, title, body, sort_order, is_active')
    .order('sort_order').order('id')) ?? []
export const fillTemplate = (body, lead) => {
  const first = (lead?.full_name ?? '').trim().split(/\s+/)[0] || ''
  return String(body ?? '').replace(/\{\{\s*name\s*\}\}/g, first)
}

// ---------- المنشن: @الاسم في النص ----------
// بنخزّن في النص «@الاسم الكامل» وفي mentions الـ ids — والعرض بيلوّن الأسماء اللي في القائمة
export function extractMentions(text, people) {
  const ids = []
  for (const p of people) {
    if (p.full_name && text.includes('@' + p.full_name)) ids.push(p.id)
  }
  return ids
}
export const addMembers   = async (convId, members) => unwrap(await supabase.rpc('chat_add_members', { p_conv: convId, p_members: members }))
export const removeMember = async (convId, userId) => unwrap(await supabase.rpc('chat_remove_member', { p_conv: convId, p_user: userId }))
export const renameGroup  = async (convId, title) => unwrap(await supabase.rpc('chat_rename_group', { p_conv: convId, p_title: title }))

export const fetchEmployees = async () =>
  unwrap(await supabase.from('profiles')
    .select('id, full_name, roles(code, name_ar, name_en)').eq('status', 'active').order('full_name')) ?? []

// بحث ليدات للإرفاق — حسب صلاحيات الموظف (RLS)
export async function searchLeads(term) {
  const s = term.trim().replace(/[%,()]/g, '')
  if (s.length < 2) return []
  const { data } = await supabase.from('leads')
    .select('id, file_no, full_name, phone')
    .or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,file_no.ilike.%${s}%`)
    .is('archived_at', null)
    .order('id', { ascending: false }).limit(8)
  return data ?? []
}

// اسم المحادثة: الجروب باسمه، والفردية باسم الطرف التاني
// (في المراقبة مفيش «أنا» — فبنعرض الطرفين)
export function convName(conv, meId) {
  if (!conv) return ''
  if (conv.kind === 'group') return conv.title || i18n.t('chat.group')
  const members = conv.members ?? []
  const others = members.filter(m => m.id !== meId)
  if (others.length === members.length) return members.map(m => m.full_name).join(' ↔ ')
  return others[0]?.full_name ?? i18n.t('chat.conversation')
}

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')

export const errText = (e) => (e?.message ? dbErr(e.message) : i18n.t('chat.genericErr'))
