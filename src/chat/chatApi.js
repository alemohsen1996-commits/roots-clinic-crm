// طبقة البيانات للشات الداخلي — كل الكتابة عبر دوال القاعدة (RPC)
// عدا إرسال الرسالة: insert مباشر محمي بـ RLS (الطرف في المحادثة فقط)
import i18n from '../i18n'
import { supabase } from '../lib/supabase'

const MSG_COLS = 'id, conversation_id, sender_id, body, lead_id, lead_label, reply_to, created_at, edited_at, deleted_at'
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
    .select('id, kind, title, lead_id, created_by, created_at').eq('id', id).single())

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

export async function sendMessage({ id, convId, senderId, body, leadId = null, replyTo = null }) {
  const { data, error } = await supabase.from('chat_messages')
    .insert({ id, conversation_id: convId, sender_id: senderId, body: body || null, lead_id: leadId, reply_to: replyTo })
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
export const createGroup = async (title, members, leadId = null) =>
  unwrap(await supabase.rpc('chat_create_group', { p_title: title, p_members: members, p_lead_id: leadId }))
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

export const errText = (e) => e?.message || i18n.t('chat.genericErr')
