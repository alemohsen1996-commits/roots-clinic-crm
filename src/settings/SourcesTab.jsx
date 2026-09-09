// تبويب مصادر الليدات — لتمييز أرقام الوكالات عن غيرها وقياس أدائها
import SimpleCrud from './SimpleCrud'

export default function SourcesTab() {
  return (
    <SimpleCrud table="lead_sources" nameField="name_ar" title="مصادر الليدات"
      placeholder="مثال: وكالة النخبة" />
  )
}
