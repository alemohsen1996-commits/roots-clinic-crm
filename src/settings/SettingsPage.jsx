// إعدادات النظام — 3 مجموعات، وكل مجموعة تبويباتها
// المدير العام يشوف كله · مدير المبيعات يشوف الفروع وساعات العمل والتقنيات بس (manager: true)
// التبويب المفتوح في الرابط (?tab=) عشان الـ refresh يرجّعك لنفس المكان
// التوزيع اليدوي بقى صفحة مستقلة (/distribute) للمدير العام ومدير المبيعات
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import StagesTab from './StagesTab'
import DistributionTab from './DistributionTab'
import ImportLeadsTab from './ImportLeadsTab'
import SourcesTab from './SourcesTab'
import DoctorsTab from './DoctorsTab'
import TechniquesTab from './TechniquesTab'
import SaleTypesTab from './SaleTypesTab'
import TeamsTab from './TeamsTab'
import BranchesTab from './BranchesTab'
import BranchHoursTab from './BranchHoursTab'
import GeneralTab from './GeneralTab'
import useT from '../i18n/useT'

// الفروع وساعات عملها في تبويب واحد
function BranchesAndHours() {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <BranchesTab />
      <BranchHoursTab />
    </div>
  )
}

// label = مفتاح ترجمة (settings.groups.* / settings.tabs.*)
const GROUPS = [
  { key: 'leads', tabs: [
    { key: 'stages',       el: StagesTab },
    { key: 'sources',      el: SourcesTab },
    { key: 'distribution', el: DistributionTab },
    { key: 'import',       el: ImportLeadsTab },
  ]},
  { key: 'clinic', tabs: [
    { key: 'branches',     el: BranchesAndHours, manager: true },
    { key: 'doctors',      el: DoctorsTab },
    { key: 'techniques',   el: TechniquesTab, manager: true },
    { key: 'sale_types',   el: SaleTypesTab },
  ]},
  { key: 'team', tabs: [
    { key: 'general',      el: GeneralTab },
    { key: 'teams',        el: TeamsTab },
  ]},
]
export default function SettingsPage() {
  const { isSuperAdmin } = useAuth()
  const { t } = useT()
  const [params, setParams] = useSearchParams()

  // المجموعات والتبويبات المسموحة للمستخدم الحالي (المجموعة الفاضية بتختفي)
  const groups = GROUPS
    .map(g => ({ ...g, tabs: g.tabs.filter(t => isSuperAdmin || t.manager) }))
    .filter(g => g.tabs.length)
  const allTabs = groups.flatMap(g => g.tabs.map(t => ({ ...t, group: g.key })))

  // الروابط القديمة (branch_hours) تفتح التبويب المدمج
  const raw = params.get('tab') === 'branch_hours' ? 'branches' : params.get('tab')
  const current = allTabs.find(t => t.key === raw) ?? allTabs[0]
  const group = groups.find(g => g.key === current.group)
  const go = (key) => setParams({ tab: key }, { replace: true })
  const Active = current.el

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('nav.settings')}</h1>
          <div className="hint">{t('settings.hint')}</div>
        </div>
      </div>

      <div className="board-tabs" role="tablist" aria-label={t('settings.groupsLabel')}>
        {groups.length > 1 && groups.map(g => (
          <button key={g.key} type="button" role="tab" aria-selected={g.key === group.key}
            className={g.key === group.key ? 'on' : ''}
            onClick={() => go(g.tabs[0].key)}>
            {t(`settings.groups.${g.key}`)}
          </button>
        ))}
      </div>

      <div className="tabs">
        {group.tabs.map(tb => (
          <button key={tb.key} type="button"
            className={'tab' + (tb.key === current.key ? ' on' : '')}
            onClick={() => go(tb.key)}>
            {t(`settings.tabs.${tb.key}`)}
          </button>
        ))}
      </div>

      <Active />
    </>
  )
}
