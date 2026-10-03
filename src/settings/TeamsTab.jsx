// تبويب الفرق
import SimpleCrud from './SimpleCrud'
import useT from '../i18n/useT'

export default function TeamsTab() {
  const { t } = useT()
  return (
    <SimpleCrud table="teams" nameField="name" title={t('settings.tabs.teams')} placeholder={t('settings.teamPh')} />
  )
}
