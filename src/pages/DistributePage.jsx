// توزيع الليدات — صفحة مستقلة للمدير العام ومدير المبيعات
// (كانت تبويب جوه إعدادات النظام، ومدير المبيعات مكانش بيقدر يوصلها)
import ManualDistributeTab from '../settings/ManualDistributeTab'

export default function DistributePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>توزيع الليدات</h1>
          <div className="hint">وزّع ليداتك والليدات اللي من غير مسؤول على الموظفين — وتقدر تتراجع عن أي دفعة</div>
        </div>
      </div>
      <ManualDistributeTab />
    </>
  )
}
