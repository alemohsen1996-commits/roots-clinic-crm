// قائمة أنواع البيع مجمّعة (optgroup): عمليات / جلسات علاج / منتجات
import { KINDS, kindLabel } from './useDealRefs'
import { dbName } from '../lib/lang'

export default function ProcedureOptions({ procedures }) {
  return KINDS.map(k => {
    const list = (procedures ?? []).filter(p => (p.kind ?? 'surgery') === k)
    if (!list.length) return null
    return (
      <optgroup key={k} label={kindLabel(k)}>
        {list.map(p => <option key={p.id} value={p.id}>{dbName(p)}</option>)}
      </optgroup>
    )
  })
}
