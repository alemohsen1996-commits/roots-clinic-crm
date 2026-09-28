// أدوات موحّدة لقوائم موظفي المبيعات
// مدير المبيعات عنده ليدات وديلات زي السيلز، فبيظهر معاهم في القوائم والفلاتر
// مع تمييز «(مدير مبيعات)» جنب اسمه

export const SALES_ROLES = ['agent', 'sales_manager']

export const isSalesPerson = (p) => SALES_ROLES.includes(p?.roles?.code)

export function salesLabel(p) {
  if (!p) return ''
  return p.roles?.code === 'sales_manager' ? `${p.full_name} (مدير مبيعات)` : p.full_name
}

// السيلز أولًا ثم المديرين، وكل مجموعة بالترتيب الأبجدي
export function sortSales(list = []) {
  const rank = (p) => (p.roles?.code === 'sales_manager' ? 1 : 0)
  return [...list].sort((a, b) =>
    rank(a) - rank(b) || (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ar'))
}
