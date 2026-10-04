// أدوات موحّدة لقوائم موظفي المبيعات
// مدير المبيعات عنده ليدات وديلات زي السيلز، فبيظهر معاهم في القوائم والفلاتر
// مع تمييز «(مدير مبيعات)» جنب اسمه

import i18n from '../i18n'

export const SALES_ROLES = ['agent', 'sales_manager']

export const isSalesPerson = (p) => SALES_ROLES.includes(p?.roles?.code)

export function salesLabel(p) {
  if (!p) return ''
  return p.roles?.code === 'sales_manager' ? `${p.full_name} (${i18n.t('roles.sales_manager')})` : p.full_name
}

// السيلز أولًا ثم المديرين، وكل مجموعة بالترتيب الأبجدي
export function sortSales(list = []) {
  const rank = (p) => (p.roles?.code === 'sales_manager' ? 1 : 0)
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
