// إعدادات النظام (المدير العام فقط) — تبويبات، كل تبويب ملف مستقل
import { useState } from 'react'
import StagesTab from './StagesTab'
import DistributionTab from './DistributionTab'
import ManualDistributeTab from './ManualDistributeTab'
import ImportLeadsTab from './ImportLeadsTab'
import SourcesTab from './SourcesTab'
import DoctorsTab from './DoctorsTab'
import TechniquesTab from './TechniquesTab'
import TeamsTab from './TeamsTab'
import BranchesTab from './BranchesTab'
import BranchHoursTab from './BranchHoursTab'
import GeneralTab from './GeneralTab'

const TABS = [
  { key: 'stages',       label: 'المراحل',           el: StagesTab },
  { key: 'distribution', label: 'توزيع الليدات',      el: DistributionTab },
  { key: 'manual_dist',  label: 'توزيع يدوي',         el: ManualDistributeTab },
  { key: 'import',       label: 'استيراد ليدات',      el: ImportLeadsTab },
  { key: 'sources',      label: 'المصادر',            el: SourcesTab },
  { key: 'doctors',      label: 'الأطباء',            el: DoctorsTab },
  { key: 'techniques',   label: 'التقنيات',           el: TechniquesTab },
  { key: 'teams',        label: 'الفرق',              el: TeamsTab },
  { key: 'branches',     label: 'الفروع',             el: BranchesTab },
  { key: 'branch_hours', label: 'ساعات الفروع',      el: BranchHoursTab },
  { key: 'general',      label: 'حدود ومالية',        el: GeneralTab },
]

export default function SettingsPage() {
  const [tab, setTab] = useState('stages')
  const Active = TABS.find(t => t.key === tab)?.el

  return (
    <>
      <div className="page-head">
        <div>
          <h1>إعدادات النظام</h1>
          <div className="hint">كل تغيير هنا يسري فورًا على النظام كله — ويُسجل في سجل التدقيق</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button key={t.key}
            className={'tab' + (tab === t.key ? ' on' : '')}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {Active && <Active />}
    </>
  )
}
