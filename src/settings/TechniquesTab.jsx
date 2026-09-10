// تبويب تقنيات الزراعة — تُدار كالأطباء والفروع
import SimpleCrud from './SimpleCrud'

export default function TechniquesTab() {
  return (
    <SimpleCrud table="techniques" nameField="name" title="تقنيات الزراعة"
      placeholder="مثال: Sapphire FUE"
      extraField={{ key: 'name_ar', label: 'الوصف بالعربية' }} />
  )
}
