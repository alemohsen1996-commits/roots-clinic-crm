// تبويب مصادر الليدات — لتمييز أرقام الوكالات عن غيرها وقياس أدائها
import SimpleCrud from './SimpleCrud'
import useT from '../i18n/useT'

export default function SourcesTab() {
  const { t } = useT()
  return (
    <SimpleCrud table="lead_sources" nameField="name_ar" nameEnField="name_en" title={t('settings.tabs.sources')}
      placeholder={t('settings.sourcePh')} />
  )
}
