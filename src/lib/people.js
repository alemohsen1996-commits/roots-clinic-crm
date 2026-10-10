// أدوات موحّدة لقوائم موظفي المبيعات
// مدير المبيعات عنده ليدات وديلات زي السيلز، فبيظهر معاهم في القوائم والفلاتر
// مع تمييز «(مدير مبيعات)» جنب اسمه
// المدير العام كمان ممكن يجيب مريض معرفة → يظهر في قوائم صاحب الليد/السيلز والكشوفات
// بتمييز «(مدير عام)» — بس مش داخل في التوزيع (SALES_ROLES)

import i18n from '../i18n'

// اللي بيستلموا ليدات في التوزيع (يدوي/تلقائي)
export const SALES_ROLES = ['agent', 'sales_manager']
// اللي ممكن يكونوا «سيلز» على ليد أو ديل (قوائم الاختيار والفلاتر والكشوفات)
export const OWNER_ROLES = [...SALES_ROLES, 'super_admin']

export const isSalesPerson = (p) => OWNER_ROLES.includes(p?.roles?.code)

export function salesLabel(p) {
  if (!p) return ''
  const code = p.roles?.code
  return code === 'sales_manager' || code === 'super_admin'
    ? `${p.full_name} (${i18n.t(`roles.${code}`)})` : p.full_name
}

// السيلز أولًا ثم مديري المبيعات ثم المدير العام، وكل مجموعة بالترتيب الأبجدي
const RANK = { agent: 0, sales_manager: 1, super_admin: 2 }
export function sortSales(list = []) {
  const rank = (p) => RANK[p.roles?.code] ?? 3
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ar'))
}

// قائمة الإسناد (مالك الليد): السيلز ومدير المبيعات + المنسقات
// المنسقة ممكن تكون صاحبة ليد (عميل جالها مباشرة) فلازم تظهر في الإسناد
export const isCoordinator = (p) => p?.roles?.code === 'coordinator'

export function assignableGroups(people = []) {
  return {
    sales: sortSales(people.filter(isSalesPerson)),
    coordinators: people.filter(isCoordinator)
      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ar')),
  }
}
