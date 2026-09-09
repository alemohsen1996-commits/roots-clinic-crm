// تبويب الأطباء
import SimpleCrud from './SimpleCrud'

export default function DoctorsTab() {
  return (
    <SimpleCrud table="doctors" nameField="full_name" title="الأطباء"
      placeholder="د. أحمد…" extraField={{ key: 'specialty', label: 'التخصص' }} />
  )
}
