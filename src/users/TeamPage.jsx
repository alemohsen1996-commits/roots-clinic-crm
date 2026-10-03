// إدارة الموظفين (المدير العام فقط)
// إضافة موظف (بالإيميل والباسورد) + تفعيل المعلّقين + نقل الليدات
// + تغيير الإيميل/الباسورد + إيقاف/تنشيط + رقم السنترال (Extension)
import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import ActivateModal from './ActivateModal'
import BulkReassignModal from './BulkReassignModal'
import AddEmployeeModal from './AddEmployeeModal'
import AccountActions from './AccountActions'
import useT from '../i18n/useT'
import { fmtDate } from '../lib/format'
import { dbName } from '../lib/lang'

export default function TeamPage() {
  const { t, dn } = useT()
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
      .select('*, roles(code, name_ar, name_en), teams:team_id(name)')
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
    active.forEach(p => { if (p.roles?.code) m.set(p.roles.code, dn(p.roles)) })
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
          <h1>{t('nav.team')}</h1>
          <div className="hint">{t('team.hint')}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setShowReassign(true)}>
            {t('team.moveLeads')}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            + {t('team.addEmployeeShort')}
          </button>
        </div>
      </div>

      {msg && <div className="alert alert-ok">{msg}</div>}

      {/* الحسابات المعلقة (لمن سجّل بنفسه) */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 16 }}>{t('team.pendingActivation')}</h2>
            <span className="badge badge-pending">{pending.length}</span>
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>{t('lead.name')}</th><th>{t('auth.email')}</th><th>{t('team.registeredAt')}</th><th></th></tr>
            </thead>
            <tbody>
              {pending.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                  <td className="ltr-cell">{p.email}</td>
                  <td>{fmtDate(p.created_at)}</td>
                  <td>
                    <button className="btn btn-primary" onClick={() => setSelected(p)}>
                      {t('team.activateAndSet')}
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
          <h2 style={{ fontSize: 16 }}>{t('team.teamTitle')}</h2>
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {filtersOn ? `${shown.length} / ${active.length}` : active.length}
          </span>
        </div>

        {active.length > 0 && (
          <div className="filters-bar" style={{ margin: '12px 16px 0', padding: 0, border: 'none', boxShadow: 'none' }}>
            <input placeholder={t('team.searchPh')} value={q}
              onChange={e => setQ(e.target.value)} style={{ minWidth: 220, flex: 1 }} />
            <select value={roleF} onChange={e => setRoleF(e.target.value)}>
              <option value="">{t('team.allRoles')}</option>
              {roleOptions.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            <select value={statusF} onChange={e => setStatusF(e.target.value)}>
              <option value="">{t('payments.allStatuses')}</option>
              <option value="active">{t('team.active')}</option>
              <option value="suspended">{t('team.suspended')}</option>
            </select>
            <select value={extF} onChange={e => setExtF(e.target.value)}>
              <option value="">Ext: {t('common.all')}</option>
              <option value="has">{t('team.hasExt')}</option>
              <option value="none">{t('team.noExt')}</option>
            </select>
            {filtersOn && <button className="btn btn-ghost btn-sm" onClick={clearFilters}>{t('team.clear')}</button>}
          </div>
        )}

        {active.length === 0 ? (
          <div className="empty"><strong>{t('team.noneYet')}</strong>{t('team.noneHint')}</div>
        ) : shown.length === 0 ? (
          <div className="empty">{t('team.noMatch')}</div>
        ) : (
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t('lead.name')}</th><th>{t('auth.email')}</th><th>{t('common.role')}</th><th>Ext</th>
                <th>{t('deals.status')}</th><th style={{ textAlign: 'end' }}>{t('team.manageAccount')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.full_name}</td>
                  <td className="ltr-cell" style={{ fontSize: 12.5 }}>{p.email}</td>
                  <td>{dn(p.roles) || '—'}</td>
                  <td>
                    <ExtCell person={p} people={allPeople}
                      onSaved={(msg) => { flash(msg); load() }} onError={flash} />
                  </td>
                  <td>
                    <span className={'badge ' + (p.status === 'active' ? 'badge-active' : 'badge-suspended')}>
                      {p.status === 'active' ? t('team.active') : t('team.suspended')}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setSelected(p)}>{t('team.permissions')}</button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setAccountAction({ person: p, mode: 'email' })}>{t('auth.email')}</button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setAccountAction({ person: p, mode: 'password' })}>{t('auth.password')}</button>
                      <button className="btn btn-danger btn-sm"
                        onClick={() => toggleSuspend(p)}>
                        {p.status === 'suspended' ? t('team.reactivate') : t('team.suspend')}
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
          onSaved={() => { setShowAdd(false); flash(t('team.createdOk')); load() }}
        />
      )}

      {selected && (
        <ActivateModal
          person={selected}
          onClose={() => setSelected(null)}
          onSaved={(name) => { setSelected(null); flash(t('team.permissionsSaved', { name })); load() }}
        />
      )}

      {accountAction && (
        <AccountActions
          person={accountAction.person}
          mode={accountAction.mode}
          onClose={() => setAccountAction(null)}
          onSaved={() => { setAccountAction(null); flash(t('team.changedOk')); load() }}
        />
      )}

      {showReassign && (
        <BulkReassignModal
          people={allPeople}
          onClose={() => setShowReassign(false)}
          onDone={() => { setShowReassign(false); flash(t('team.leadsMoved')); load() }}
        />
      )}
    </>
  )
}

// رقم السنترال (Azeer Extension) — تعديل مباشر من الجدول
// تغييره أو مسحه مش بيأثر على المكالمات القديمة: بتفضل باسم الموظف اللي عملها
function ExtCell({ person, people, onSaved, onError }) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(person.phone_ext ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    const ext = val.trim()
    if (ext === (person.phone_ext ?? '')) { setEditing(false); return }
    if (ext && !/^\d{3,6}$/.test(ext)) { onError(t('team.extDigits')); return }
    const owner = ext && people.find(x => x.phone_ext === ext && x.id !== person.id)
    if (owner && !confirm(t('team.extTakenQ', { ext, owner: owner.full_name, name: person.full_name }))) return
    setBusy(true)
    const { data, error } = await supabase.rpc('set_phone_ext', { p_user: person.id, p_ext: ext })
    setBusy(false)
    if (error) { onError(error.message); return }
    setEditing(false)
    const linked = data?.users_linked ? ` — ${t('team.extLinked', { n: data.users_linked })}` : ''
    onSaved(ext ? t('team.extSaved', { ext, name: person.full_name }) + linked : t('team.extRemoved', { name: person.full_name }))
  }

  if (!editing) {
    return (
      <button className="btn btn-ghost btn-sm" style={{ minWidth: 64, direction: 'ltr' }}
        title={t('team.editExt')}
        onClick={() => { setVal(person.phone_ext ?? ''); setEditing(true) }}>
        {person.phone_ext || `+ ${t('common.add')}`}
      </button>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input autoFocus value={val} inputMode="numeric" dir="ltr" placeholder="7000"
        style={{ width: 80 }} disabled={busy}
        onChange={e => setVal(e.target.value.replace(/\D/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{t('common.save')}</button>
      {person.phone_ext && (
        <button className="btn btn-ghost btn-sm" disabled={busy} title={t('team.unlink')}
          onClick={() => setVal('')}>{t('team.clear')}</button>
      )}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEditing(false)}>✕</button>
    </div>
  )
}
