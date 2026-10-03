// تبويب الأطباء
import SimpleCrud from './SimpleCrud'
import useT from '../i18n/useT'

export default function DoctorsTab() {
  const { t } = useT()
  return (
    <SimpleCrud table="doctors" nameField="full_name" title={t('settings.tabs.doctors')}
      placeholder={t('settings.doctorPh')} extraField={{ key: 'specialty', label: t('settings.specialty') }} />
  )
}
