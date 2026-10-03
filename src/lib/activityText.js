// نصوص سجل النشاط المولّدة من النظام بتتخزن عربي (بيانات مشتركة بين الفريق)،
// وهنا بنعرضها بلغة الموظف. أي نص مش مطابق (ملاحظات حرة) بيتعرض زي ما هو.
import i18n from '../i18n'

const CUR = /\s*ر\.س/g

// [regex على أول سطر, مفتاح الترجمة, استخراج المتغيرات]
const RULES = [
  [/^اتصال — لم يرد$/, 'noAnswer'],
  [/^تم التواصل مع العميل$/, 'contacted'],
  [/^العميل مهتم$/, 'interested'],
  [/^العميل غير مهتم$/, 'notInterested'],
  [/^تم تنفيذ مهمة المتابعة(?::\s*(.*))?$/, 'taskDone', null, (m) => (m[1] ? `: ${m[1]}` : '')],
  [/^إيقاف المتابعة$/, 'followPaused'],
  [/^استئناف المتابعة$/, 'followResumed'],
  [/^توزيع تلقائي عند الإنشاء$/, 'autoAssigned'],
  [/^بدون سعر$/, 'noPrice'],
  [/^السعر: (.+)$/, 'price', (m) => ({ v: m[1].replace(CUR, ' ' + i18n.t('common.currency')) })],
  [/^تعديل السعر من (.+?) إلى (.+)$/, 'priceChanged',
    (m) => ({ a: m[1].replace(CUR, ''), b: m[2].replace(CUR, ' ' + i18n.t('common.currency')) })],
  [/^تعديل مالية الديل #(\d+): التعاقد (.+?) ← (.+?) ر\.س · الضريبة (.+?) ← (.+?) ر\.س$/, 'dealFinance',
    (m) => ({ id: m[1], a: m[2], b: m[3], c: m[4], d: m[5], cur: i18n.t('common.currency') })],
]

export function activityText(content) {
  const text = String(content ?? '')
  if (!text || i18n.language !== 'en') return text
  const nl = text.indexOf('\n')
  const first = nl === -1 ? text : text.slice(0, nl)
  const rest = nl === -1 ? '' : text.slice(nl)
  for (const [re, key, vars, suffix] of RULES) {
    const m = re.exec(first.trim())
    if (m) return i18n.t(`activityText.${key}`, vars ? vars(m) : {}) + (suffix ? suffix(m) : '') + rest
  }
  return text
}
