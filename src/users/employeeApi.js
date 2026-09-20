// نداء Edge Function لإدارة حسابات الموظفين
// المفتاح السري لا يصل هنا إطلاقًا — كل شيء يتم على سيرفر Supabase
import { supabase } from '../lib/supabase'

async function callManage(payload) {
  const { data, error } = await supabase.functions.invoke('manage-employee', {
    body: payload,
  })
  if (error) {
    // محاولة قراءة رسالة الخطأ من جسم الرد
    let msg = 'تعذر تنفيذ العملية'
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) msg = ctx.error
    } catch {}
    return { error: msg }
  }
  if (data?.error) return { error: data.error }
  return { data }
}

export const createEmployee = (p) => callManage({ action: 'create', ...p })
export const changeEmployeeEmail = (p) => callManage({ action: 'change_email', ...p })
export const changeEmployeePassword = (p) => callManage({ action: 'change_password', ...p })

// عشوائية آمنة تشفيريًا: عدد صحيح في [0, max) بلا تحيّز باقي القسمة
// (نرفض العيّنات فوق أكبر مضاعف لـ max يقلّ عن 2^32)
function secureRandInt(max) {
  const limit = Math.floor(0xFFFFFFFF / max) * max
  const buf = new Uint32Array(1)
  let x
  do { crypto.getRandomValues(buf); x = buf[0] } while (x >= limit)
  return x % max
}

// اختيار حرف عشوائي آمن من مجموعة
const pick = (set) => set[secureRandInt(set.length)]

// مولّد كلمة مرور قوية (حروف كبيرة/صغيرة + أرقام + رمز)
// يستعمل crypto.getRandomValues — عشوائية غير قابلة للتنبّؤ، مناسبة للأسرار
export function generatePassword(len = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const nums = '23456789'
  const sym = '!@#$%&*'
  const all = upper + lower + nums + sym

  // نضمن حرفًا واحدًا على الأقل من كل فئة
  const pass = [pick(upper), pick(lower), pick(nums), pick(sym)]
  for (let i = pass.length; i < len; i++) pass.push(pick(all))

  // خلط Fisher–Yates بعشوائية آمنة — يزيل انتظام "أول ٤ حروف = فئات ثابتة"
  for (let i = pass.length - 1; i > 0; i--) {
    const j = secureRandInt(i + 1)
    ;[pass[i], pass[j]] = [pass[j], pass[i]]
  }
  return pass.join('')
}
