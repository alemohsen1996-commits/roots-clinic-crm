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

// مولّد كلمة مرور قوية (حروف كبيرة/صغيرة + أرقام + رمز)
export function generatePassword(len = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const nums = '23456789'
  const sym = '!@#$%&*'
  const all = upper + lower + nums + sym
  let pass = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    nums[Math.floor(Math.random() * nums.length)],
    sym[Math.floor(Math.random() * sym.length)],
  ]
  for (let i = pass.length; i < len; i++) {
    pass.push(all[Math.floor(Math.random() * all.length)])
  }
  // خلط
  return pass.sort(() => Math.random() - 0.5).join('')
}
