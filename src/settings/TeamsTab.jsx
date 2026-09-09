// تبويب الفرق
import SimpleCrud from './SimpleCrud'

export default function TeamsTab() {
  return (
    <SimpleCrud table="teams" nameField="name" title="الفرق" placeholder="فريق المبيعات أ" />
  )
}
