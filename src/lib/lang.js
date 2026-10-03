// اللغة — بتتطبق على <html lang dir>، وبتتحفظ محليًا (عشان الصفحة تفتح بيها فورًا من غير وميض)
// وفي profiles.lang (عشان الموظف يلاقيها على أي جهاز)
import i18n from '../i18n'

export const LANGS = [
  { key: 'ar', label: 'العربية', dir: 'rtl' },
  { key: 'en', label: 'English', dir: 'ltr' },
]

const KEY = 'lang'
const valid = (k) => LANGS.some(l => l.key === k)

export function getLocalLang() {
  try { const k = localStorage.getItem(KEY); return valid(k) ? k : 'ar' } catch { return 'ar' }
}

export function applyLang(key) {
  const k = valid(key) ? key : 'ar'
  const root = document.documentElement
  root.setAttribute('lang', k)
  root.setAttribute('dir', LANGS.find(l => l.key === k).dir)
  try { localStorage.setItem(KEY, k) } catch {}
  if (i18n.language !== k) i18n.changeLanguage(k)
  return k
}

export const currentLang = () => (i18n.language === 'en' ? 'en' : 'ar')
export const isRtl = () => currentLang() === 'ar'

// اسم صف من الداتابيز حسب اللغة: name_en لو إنجليزي ومتوفر، وإلا name_ar (أو name)
// يقبل صف فيه name_ar/name_en، أو نص عادي (يرجع زي ما هو)
export function dbName(row) {
  if (row == null) return ''
  if (typeof row === 'string') return row
  const en = row.name_en
  if (currentLang() === 'en' && en) return en
  return row.name_ar ?? row.name ?? en ?? ''
}
