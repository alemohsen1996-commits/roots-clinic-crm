// قمع المبيعات — عدد الليدات في كل مرحلة بأشرطة بألوان المراحل نفسها
import { fmtNum } from '../lib/format'

export default function Funnel({ stages, counts, subtitle }) {
  const max = Math.max(1, ...Object.values(counts))
  const open = stages.filter(s => s.category === 'open')
  const outcomes = stages.filter(s => s.category !== 'open')

  const Bar = ({ st }) => {
    const n = counts[st.id] ?? 0
    const pct = max ? (n / max) * 100 : 0
    return (
      <div className="funnel-row">
        <span className="funnel-label">{st.name_ar}</span>
        <div className="funnel-track">
          <div className="funnel-bar" style={{ width: `${pct}%`, background: st.color }} />
        </div>
        <span className="funnel-count">{fmtNum(n)}</span>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 16, marginBottom: subtitle ? 4 : 14 }}>قمع المبيعات</h2>
      {subtitle && (
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 14, lineHeight: 1.6 }}>
          {subtitle}
        </p>
      )}
      {open.map(st => <Bar key={st.id} st={st} />)}
      <div style={{ borderTop: '1px dashed var(--line)', margin: '10px 0' }} />
      {outcomes.map(st => <Bar key={st.id} st={st} />)}
    </div>
  )
}
