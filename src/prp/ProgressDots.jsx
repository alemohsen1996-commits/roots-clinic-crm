// شريط تقدم الجلسات ●●○○ — مكوّن مستقل يستخدمه PrpPage و PrpDrawer
import useT from '../i18n/useT'

export default function ProgressDots({ done, total }) {
  const { t } = useT()
  return (
    <span className="prp-dots" title={t('prp.dotsTitle', { done, total })}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'dot-done' : 'dot-todo'}>●</span>
      ))}
    </span>
  )
}
