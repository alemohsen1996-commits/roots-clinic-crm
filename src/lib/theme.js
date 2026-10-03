// الثيمات — بتتطبق عن طريق data-theme على <html>، والقيم نفسها في styles.css
// الاختيار بيتحفظ محليًا (عشان الصفحة تفتح بيه فورًا من غير وميض)
// وفي profiles.theme (عشان الموظف يلاقيه على أي جهاز)

export const THEMES = [
  // label = مفتاح ترجمة (themes.*)
  { key: 'default', label: 'themes.default', swatch: ['#0f1b2d', '#1a3a5c', '#c9a24b'], bar: '#0f1b2d' },
  { key: 'teal',    label: 'themes.teal',    swatch: ['#0b2f2e', '#0f6b63', '#e0621a'], bar: '#0b2f2e' },
  { key: 'pink',    label: 'themes.pink',   swatch: ['#f4f1f3', '#c21f72', '#8e44c9'], bar: '#f4f1f3' },
  { key: 'dark',    label: 'themes.dark',   swatch: ['#1a1827', '#7b64e6', '#f05aa3'], bar: '#1a1827' },
]

const KEY = 'theme'
const valid = (k) => THEMES.some(t => t.key === k)

export function getLocalTheme() {
  try { const k = localStorage.getItem(KEY); return valid(k) ? k : 'default' } catch { return 'default' }
}

export function applyTheme(key) {
  const k = valid(key) ? key : 'default'
  const root = document.documentElement
  if (k === 'default') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', k)
  // لون شريط المتصفح على الموبايل
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEMES.find(t => t.key === k).bar)
  try { localStorage.setItem(KEY, k) } catch {}
  return k
}
