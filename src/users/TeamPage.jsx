// إدارة الموظفين (المدير العام فقط)
// إضافة موظف (بالإيميل والباسورد) + تفعيل المعلّقين + نقل الليدات
// + تغيير الإيميل/الباسورد + إيقاف/تنشيط + رقم السنترال (Extension)
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import ActivateModal from './ActivateModal'
import BulkReassignModal from './BulkReassignModal'
import AddEmployeeModal from './AddEmployeeModal'
import AccountActions from './AccountActions'

export default function TeamPage() {
  const [pending, setPending] = useState([])
  const [active, setActive] = useState([])
  const [allPeople, setAllPeople] = useState([])
  const [selected, setSelected] = useState(null)
  const [showReassign, setShowReassign] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [accountAction, setAccountAction] = useState(null)  // { person, mode }
  const [msg, setMsg] = useState('')
  // فلاتر فريق العمل
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('')
  const [statusF, setStatusF] = useState('')     // '' | active | suspended
  const [extF, setExtF] = useState('')           // '' | has | none

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, roles(code, name_ar), teams:team_id(name)')
      .order('created_at', { ascending: false })
    const rows = data ?? []
    // allPeople فيها الكل (لفحص تعارض الـ Extensions)، أما القوايم المعروضة
    // فمخفي منها المدير العام عشان صلاحياته متتعدّلش بالغلط (ومحمي كمان في قاعدة البيانات)
    setAllPeople(rows)
    const shown = rows.filter(p => p.roles?.code !== 'super_admin')
    setPending(shown.filter(p => p.status === 'pending'))
    setActive(shown.filter(p => p.status !== 'pending'))
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleSuspend(p) {
    const next = p.status === 'suspended' ? 'active' : 'suspended'
    await supabase.from('profiles').update({ status: next }).eq('id', p.id)
    load()
  }

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }

  // الأدوار الموجودة فعلًا في الفريق (للقايمة)
  const roleOptions = useMemo(() => {
    const m = new Map()
    active.forEach(p => { if (p.roles?.code) m.set(p.roles.code, p.roles.name_ar) })
    return [...m]
  }, [active])

  const filtersOn = !!(q || roleF || statusF || extF)
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return active.filter(p => {
      if (roleF && p.roles?.code !== roleF) return false
      if (statusF && p.status !== statusF) return false
      if (extF === 'has' && !p.phone_ext) return false
      if (extF === 'none' && p.phone_ext) return false
      if (term) {
        const hay = `${p.full_name ?? ''} ${p.email ?? ''} ${p.phone_ext ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [active, q, roleF, statusF, extF])

  const clearFilters = () => { setQ(''); setRoleF(''); setStatusF(''); setExtF('') }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>الموظفون</h1>
          <div className="hint">إنشاء الحسابات وإدارة الصلاحيات</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setShowReassign(true)}>
            نقل الليدات
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + إضافة موظف
          </button>
        </div>
      </div>

      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* الحسابات المعلقة (لمن سجّل بنفسه) */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 16 }}>بانتظار التفعيل</h2>
            <span className="badge badge-pending">{pending.length}</span>
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>الاسم</th><th>البريد</th><th>تاريخ التسجيل</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                  <td dir="ltr" style={{ textAlign: 'right' }}>{p.email}</td>
                  <td>{new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
                  <td>
                    <button className="btn btn-primary" onClick={() => setSelected(p)}>
                      تفعيل وتحديد الصلاحيات
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* الموظفون النشطون */}
      <div className="card">
        <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>فريق العمل</h2>
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {filtersOn ? `${shown.length} من ${active.length}` : active.length}
          </span>
        </div>

        {active.length > 0 && (
          <div className="filters-bar" style={{ margin: '12px 16px 0', padding: 0, border: 'none', boxShadow: 'none' }}>
            <input placeholder="بحث بالاسم أو البريد أو الـ Ext…" value={q}
              onChange={e => setQ(e.target.value)} style={{ minWidth: 220, flex: 1 }} />
            <select value={roleF} onChange={e => setRoleF(e.target.value)}>
              <option value="">كل الأدوار</option>
              {roleOptions.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            <select value={statusF} onChange={e => setStatusF(e.target.value)}>
              <option value="">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="suspended">موقوف</option>
            </select>
            <select value={extF} onChange={e => setExtF(e.target.value)}>
              <option value="">Ext: الكل</option>
              <option value="has">ليه Ext</option>
              <option value="none">من غير Ext</option>
            </select>
            {filtersOn && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>مسح</button>}
          </div>
        )}

        {active.length === 0 ? (
          <div className="empty"><strong>لا يوجد موظفون بعد</strong>ابدأ بإضافة موظف</div>
        ) : shown.length === 0 ? (
          <div className="empty">مفيش موظفين بالفلاتر دي</div>
        ) : (
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>الاسم</th><th>البريد</th><th>الدور</th><th>Ext</th>
                <th>الحالة</th><th style={{ textAlign: 'left' }}>إدارة الحساب</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                  <td dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{p.email}</td>
                  <td>{p.roles?.name_ar ?? '—'}</td>
                  <td>
                    <ExtCell person={p} people={allPeople}
                      onSaved={(t) => { flash(t); load() }} onError={flash} />
                  </td>
                  <td>
                    <span className={'badge ' + (p.status === 'active' ? 'badge-active' : 'badge-suspended')}>
                      {p.status === 'active' ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setSelected(p)}>الصلاحيات</button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setAccountAction({ person: p, mode: 'email' })}>البريد</button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setAccountAction({ person: p, mode: 'password' })}>كلمة المرور</button>
                      <button className="btn btn-danger btn-sm"
                        onClick={() => toggleSuspend(p)}>
                        {p.status === 'suspended' ? 'تنشيط' : 'إيقاف'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddEmployeeModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); flash('تم إنشاء الحساب بنجاح'); load() }}
        />
      )}

      {selected && (
        <ActivateModal
          person={selected}
          onClose={() => setSelected(null)}
          onSaved={(name) => { setSelected(null); flash(`تم حفظ صلاحيات ${name}`); load() }}
        />
      )}

      {accountAction && (
        <AccountActions
          person={accountAction.person}
          mode={accountAction.mode}
          onClose={() => setAccountAction(null)}
          onSaved={() => { setAccountAction(null); flash('تم التغيير بنجاح'); load() }}
        />
      )}

      {showReassign && (
        <BulkReassignModal
          people={allPeople}
          onClose={() => setShowReassign(false)}
          onDone={() => { setShowReassign(false); flash('تم نقل الليدات'); load() }}
        />
      )}
    </>
  )
}

// رقم السنترال (Azeer Extension) — تعديل مباشر من الجدول
// تغييره أو مسحه مش بيأثر على المكالمات القديمة: بتفضل باسم الموظف اللي عملها
function ExtCell({ person, people, onSaved, onError }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(person.phone_ext ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    const ext = val.trim()
    if (ext === (person.phone_ext ?? '')) { setEditing(false); return }
    if (ext && !/^\d{3,6}$/.test(ext)) { onError('رقم الـ Extension لازم يكون أرقام بس (من 3 لـ 6)'); return }
    const owner = ext && people.find(x => x.phone_ext === ext && x.id !== person.id)
    if (owner && !confirm(`الرقم ${ext} مربوط حاليًا بـ ${owner.full_name}. تنقله لـ ${person.full_name}؟`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('set_phone_ext', { p_user: person.id, p_ext: ext })
    setBusy(false)
    if (error) { onError(error.message); return }
    setEditing(false)
    const linked = data?.users_linked ? ` — واتربطت ${data.users_linked} مكالمة قديمة` : ''
    onSaved(ext ? `اتحفظ Ext ${ext} لـ ${person.full_name}${linked}` : `اتشال الـ Ext من ${person.full_name}`)
  }

  if (!editing) {
    return (
      <button className="btn btn-ghost btn-sm" style={{ minWidth: 64, direction: 'ltr' }}
        title="تعديل رقم السنترال"
        onClick={() => { setVal(person.phone_ext ?? ''); setEditing(true) }}>
        {person.phone_ext || '+ إضافة'}
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input autoFocus value={val} inputMode="numeric" dir="ltr" placeholder="7000"
        style={{ width: 80 }} disabled={busy}
        onChange={e => setVal(e.target.value.replace(/\D/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>حفظ</button>
      {person.phone_ext && (
        <button className="btn btn-ghost btn-sm" disabled={busy} title="إلغاء الربط"
          onClick={() => setVal('')}>مسح</button>
      )}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>✕</button>
    </div>
  )
}
