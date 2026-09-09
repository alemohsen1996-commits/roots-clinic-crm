// تبويب الفروع — المدير يضيف/يعدّل/يعطّل الفروع
import SimpleCrud from './SimpleCrud'

export default function BranchesTab() {
  return (
    <SimpleCrud table="branches" nameField="name" title="الفروع" placeholder="مثال: فرع الرياض" />
  )
}
