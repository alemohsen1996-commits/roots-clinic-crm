// توزيع الليدات — صفحة مستقلة للمدير العام ومدير المبيعات
// (كانت تبويب جوه إعدادات النظام، ومدير المبيعات مكانش بيقدر يوصلها)
import ManualDistributeTab from '../settings/ManualDistributeTab'
import useT from '../i18n/useT'

export default function DistributePage() {
  const { t } = useT()
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.distribute')}</h1>
          <div className="hint">{t('distribute.hint')}</div>
        </div>
      </div>
      <ManualDistributeTab />
    </>
  )
}
