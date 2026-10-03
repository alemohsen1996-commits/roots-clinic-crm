// تبويب تقنيات الزراعة — تُدار كالأطباء والفروع
import SimpleCrud from './SimpleCrud'
import useT from '../i18n/useT'

export default function TechniquesTab() {
  const { t } = useT()
  return (
    <SimpleCrud table="techniques" nameField="name" title={t('settings.tabs.techniques')}
      placeholder="e.g. Sapphire FUE"
      extraField={{ key: 'name_ar', label: t('settings.arabicDesc') }} />
  )
}
