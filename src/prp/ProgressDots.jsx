// شريط تقدم الجلسات ●●○○ — مكوّن مستقل يستخدمه PrpPage و PrpDrawer
export default function ProgressDots({ done, total }) {
  return (
    <span className="prp-dots" title={`${done} من ${total} جلسات`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'dot-done' : 'dot-todo'}>●</span>
      ))}
    </span>
  )
}
