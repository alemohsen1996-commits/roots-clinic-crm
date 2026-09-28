// إعدادات النظام (المدير العام فقط) — 3 مجموعات، وكل مجموعة تبويباتها
// التبويب المفتوح في الرابط (?tab=) عشان الـ refresh يرجّعك لنفس المكان
// التوزيع اليدوي بقى صفحة مستقلة (/distribute) للمدير العام ومدير المبيعات
import { useSearchParams } from 'react-router-dom'
import StagesTab from './StagesTab'
import DistributionTab from './DistributionTab'
import ImportLeadsTab from './ImportLeadsTab'
import SourcesTab from './SourcesTab'
import DoctorsTab from './DoctorsTab'
import TechniquesTab from './TechniquesTab'
import TeamsTab from './TeamsTab'
import BranchesTab from './BranchesTab'
import BranchHoursTab from './BranchHoursTab'
import GeneralTab from './GeneralTab'

// الفروع وساعات عملها في تبويب واحد
function BranchesAndHours() {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <BranchesTab />
      <BranchHoursTab />
    </div>
  )
}

const GROUPS = [
  { key: 'leads', label: 'الليدات', tabs: [
    { key: 'stages',       label: 'المراحل',          el: StagesTab },
    { key: 'sources',      label: 'المصادر',          el: SourcesTab },
    { key: 'distribution', label: 'التوزيع التلقائي', el: DistributionTab },
    { key: 'import',       label: 'استيراد ليدات',    el: ImportLeadsTab },
  ]},
  { key: 'clinic', label: 'العيادة', tabs: [
    { key: 'branches',     label: 'الفروع وساعات العمل', el: BranchesAndHours },
    { key: 'doctors',      label: 'الأطباء',             el: DoctorsTab },
    { key: 'techniques',   label: 'التقنيات',            el: TechniquesTab },
  ]},
  { key: 'team', label: 'الفريق والمالية', tabs: [
    { key: 'general',      label: 'الحدود والعمولات', el: GeneralTab },
    { key: 'teams',        label: 'الفرق',            el: TeamsTab },
  ]},
]
const ALL_TABS = GROUPS.flatMap(g => g.tabs.map(t => ({ ...t, group: g.key })))

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  // الروابط القديمة (branch_hours) تفتح التبويب المدمج
  const raw = params.get('tab') === 'branch_hours' ? 'branches' : params.get('tab')
  const current = ALL_TABS.find(t => t.key === raw) ?? ALL_TABS[0]
  const group = GROUPS.find(g => g.key === current.group)
  const go = (key) => setParams({ tab: key }, { replace: true })
  const Active = current.el

  return (
    <>
      <div className="page-head">
        <div>
          <h1>إعدادات النظام</h1>
          <div className="hint">كل تغيير هنا يسري فورًا على النظام كله — ويُسجل في سجل التدقيق</div>
        </div>
      </div>

      <div className="board-tabs" role="tablist" aria-label="مجموعات الإعدادات">
        {GROUPS.map(g => (
          <button key={g.key} type="button" role="tab" aria-selected={g.key === group.key}
            className={g.key === group.key ? 'on' : ''}
            onClick={() => go(g.tabs[0].key)}>
            {g.label}
          </button>
        ))}
      </div>

      <div className="tabs">
        {group.tabs.map(t => (
          <button key={t.key} type="button"
            className={'tab' + (t.key === current.key ? ' on' : '')}
            onClick={() => go(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <Active />
    </>
  )
}
