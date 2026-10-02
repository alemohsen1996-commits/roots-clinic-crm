// قائمة أنواع البيع مجمّعة (optgroup): عمليات / جلسات علاج / منتجات
import { KIND_LABEL } from './useDealRefs'

export default function ProcedureOptions({ procedures }) {
  return ['surgery', 'treatment', 'product'].map(k => {
    const list = (procedures ?? []).filter(p => (p.kind ?? 'surgery') === k)
    if (!list.length) return null
    return (
      <optgroup key={k} label={KIND_LABEL[k]}>
        {list.map(p => <option key={p.id} value={p.id}>{p.name_ar}</option>)}
      </optgroup>
    )
  })
}
