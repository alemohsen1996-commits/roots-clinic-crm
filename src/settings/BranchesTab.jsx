// تبويب الفروع — المدير يضيف/يعدّل/يعطّل الفروع
import SimpleCrud from './SimpleCrud'
import useT from '../i18n/useT'

export default function BranchesTab() {
  const { t } = useT()
  return (
    <SimpleCrud table="branches" nameField="name" nameEnField="name_en" title={t('settings.tabs.branches')} placeholder={t('settings.branchPh')} />
  )
}
