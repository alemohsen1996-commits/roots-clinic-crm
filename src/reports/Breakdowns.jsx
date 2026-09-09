// تفصيلات: الليدات حسب المصدر + أسباب الخسارة
// أسباب الخسارة هي أثمن تقرير — تعرف منه أهم شيء تصلحه
import { fmtNum } from '../lib/format'

function BreakdownCard({ title, items, color = 'var(--primary)' }) {
  const max = Math.max(1, ...items.map(i => i.count))
  return (
    <div className="card" style={{ padding: 18 }}>
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>{title}</h2>
      {items.length === 0 && <div className="empty" style={{ padding: 12 }}>لا بيانات بعد</div>}
      {items.map(i => (
        <div className="funnel-row" key={i.label}>
          <span className="funnel-label">{i.label}</span>
          <div className="funnel-track">
            <div className="funnel-bar" style={{ width: `${(i.count / max) * 100}%`, background: color }} />
          </div>
          <span className="funnel-count">{fmtNum(i.count)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Breakdowns({ bySource, byLostReason }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
      <BreakdownCard title="الليدات حسب المصدر" items={bySource} />
      <BreakdownCard title="أسباب خسارة العملاء" items={byLostReason} color="var(--danger)" />
    </div>
  )
}
