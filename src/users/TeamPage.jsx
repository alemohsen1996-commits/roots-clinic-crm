// إدارة الموظفين (المدير العام فقط)
// إضافة موظف (بالإيميل والباسورد) + تفعيل المعلّقين + نقل الليدات
// + تغيير الإيميل/الباسورد + إيقاف/تنشيط
import { useEffect, useState, useCallback } from 'react'
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

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*, roles(code, name_ar), teams:team_id(name)')
      .order('created_at', { ascending: false })
    const rows = data ?? []
    setAllPeople(rows)
    setPending(rows.filter(p => p.status === 'pending'))
    setActive(rows.filter(p => p.status !== 'pending'))
  }, [])

  useEffect(() => { load() }, [load])

  async function toggleSuspend(p) {
    const next = p.status === 'suspended' ? 'active' : 'suspended'
    await supabase.from('profiles').update({ status: next }).eq('id', p.id)
    load()
  }

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 4000) }

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
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 16 }}>فريق العمل</h2>
        </div>
        {active.length === 0 ? (
          <div className="empty"><strong>لا يوجد موظفون بعد</strong>ابدأ بإضافة موظف</div>
        ) : (
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>الاسم</th><th>البريد</th><th>الدور</th>
                <th>الحالة</th><th style={{ textAlign: 'left' }}>إدارة الحساب</th>
              </tr>
            </thead>
            <tbody>
              {active.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                  <td dir="ltr" style={{ textAlign: 'right', fontSize: 12.5 }}>{p.email}</td>
                  <td>{p.roles?.name_ar ?? '—'}</td>
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
