// التوزيع اليدوي — المدير يوزّع ليداته والليدات بدون مسؤول على الموظفين
// المصدر: ليدات المدير + بدون مسؤول فقط (لا تُسحب ليدات موظف آخر)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SALES_ROLES, salesLabel, sortSales } from '../lib/people'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import useT from '../i18n/useT'
import { dbErr } from '../lib/dbErrors'

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US')

export default function ManualDistributeTab() {
  const { profile } = useAuth()
  const { t: tr, dn } = useT()

  // مراجع
  const [stages, setStages] = useState([])
  const [branches, setBranches] = useState([])
  const [agents, setAgents] = useState([])
  const [load, setLoad] = useState({})     // user_id -> عدد الليدات المفتوحة
  const [batches, setBatches] = useState([])

  // الفلاتر
  const [fromStages, setFromStages] = useState([])
  const [branchId, setBranchId] = useState('')
  const [toStage, setToStage] = useState('')      // '' = بدون تغيير
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // الاختيار والتوزيع
  const [picked, setPicked] = useState({})        // user_id -> عدد
  const [matched, setMatched] = useState(null)    // عدد الليدات المطابقة
  const [preview, setPreview] = useState(null)    // { items, perUser }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  // ---------- تحميل المراجع ----------
  const loadRefs = useCallback(async () => {
    const [{ data: st }, { data: br }, { data: ag }, { data: ld }, { data: bt }] = await Promise.all([
      supabase.from('stages').select('id, name_ar, name_en, code, board, category').order('sort_order'),
      supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('id'),
      supabase.from('profiles')
        .select('id, full_name, weight, daily_cap, in_rotation, roles!inner(code)')
        .eq('status', 'active').in('roles.code', SALES_ROLES),
      supabase.rpc('agent_open_load'),
      supabase.from('distribution_batches').select('*').order('id', { ascending: false }).limit(10),
    ])
    setStages(st ?? [])
    setBranches(br ?? [])
    setAgents(sortSales(ag ?? []))
    setLoad(Object.fromEntries((ld ?? []).map(r => [r.user_id, r.open_leads])))
    setBatches(bt ?? [])
  }, [])
  useEffect(() => { loadRefs() }, [loadRefs])

  const openStages = useMemo(
    () => stages.filter(s => s.category === 'open' || s.category === 'waiting'),
    [stages]
  )

  // ---------- بناء استعلام الليدات المرشّحة ----------
  const buildQuery = useCallback((cols, opts = {}) => {
    let q = supabase.from('leads').select(cols, opts)
      .is('archived_at', null)
      .or(`owner_id.is.null,owner_id.eq.${profile?.id}`)
    if (fromStages.length) q = q.in('stage_id', fromStages)
    if (branchId) q = q.eq('branch_id', Number(branchId))
    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59')
    return q
  }, [profile?.id, fromStages, branchId, dateFrom, dateTo])

  // ---------- عدّ الليدات المطابقة ----------
  async function countMatches() {
    setMsg(null); setPreview(null)
    if (!fromStages.length) { setMsg({ t: 'err', m: tr('manual.pickStage') }); return }
    setBusy(true)
    const { count, error } = await buildQuery('id', { count: 'exact', head: true })
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: tr('manual.searchFailed') + ' — ' + dbErr(error.message) }); return }
    setMatched(count ?? 0)
  }

  // ---------- أدوات الاختيار ----------
  const selected = agents.filter(a => picked[a.id] > 0)
  const totalPicked = selected.reduce((s, a) => s + Number(picked[a.id] || 0), 0)

  function setCount(id, v) {
    const n = Math.max(0, Number(v) || 0)
    setPicked(p => ({ ...p, [id]: n }))
    setPreview(null)
  }

  function splitEqually() {
    if (!matched) { setMsg({ t: 'err', m: tr('manual.searchFirst') }); return }
    const ids = agents.filter(a => picked[a.id] !== undefined && picked[a.id] !== null).map(a => a.id)
    const targets = ids.length ? ids : agents.map(a => a.id)
    const base = Math.floor(matched / targets.length)
    const rest = matched % targets.length
    const next = {}
    targets.forEach((id, i) => { next[id] = base + (i < rest ? 1 : 0) })
    setPicked(next)
    setPreview(null)
  }

  function fillByWeight() {
    if (!matched) { setMsg({ t: 'err', m: tr('manual.searchFirst') }); return }
    const pool = agents.filter(a => a.in_rotation)
    const totalW = pool.reduce((s, a) => s + (a.weight || 1), 0)
    if (!totalW) return
    const next = {}
    pool.forEach(a => { next[a.id] = Math.floor(matched * (a.weight || 1) / totalW) })
    setPicked(next)
    setPreview(null)
  }

  // ---------- المعاينة ----------
  async function buildPreview() {
    setMsg(null)
    if (!selected.length) { setMsg({ t: 'err', m: tr('manual.pickEmployee') }); return }
    setBusy(true)
    // الأقدم أولًا — نجلب فقط العدد المطلوب
    const { data, error } = await buildQuery('id, full_name, created_at')
      .order('created_at', { ascending: true })
      .limit(totalPicked)
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: tr('settings.loadFailed') + ' — ' + dbErr(error.message) }); return }

    const cands = data ?? []
    // توزيع دوري: واحد لكل موظف بالتناوب حتى ينفد نصيبه
    const remain = selected.map(a => ({ id: a.id, name: a.full_name, left: Number(picked[a.id]) }))
    const items = []
    let i = 0
    for (const lead of cands) {
      let tries = 0
      while (tries <= remain.length && remain[i % remain.length].left <= 0) { i++; tries++ }
      const t = remain[i % remain.length]
      if (!t || t.left <= 0) break
      items.push({ lead_id: lead.id, to_user: t.id })
      t.left--
      i++
    }
    const perUser = remain.map(r => ({
      name: r.name,
      got: Number(picked[r.id]) - r.left,
    }))
    setPreview({ items, perUser, shortfall: totalPicked - items.length })
  }

  // ---------- التنفيذ ----------
  async function execute() {
    if (!preview?.items.length) return
    setBusy(true)
    const { error } = await supabase.rpc('apply_manual_distribution', {
      p_items: preview.items,
      p_new_stage_id: toStage ? Number(toStage) : null,
    })
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: tr('manual.distFailed') + ' — ' + dbErr(error.message) }); return }
    setMsg({ t: 'ok', m: tr('manual.distributed', { n: fmt(preview.items.length) }) })
    setPreview(null); setPicked({}); setMatched(null)
    loadRefs()
  }

  async function undo(id) {
    if (!window.confirm(tr('manual.undoQ'))) return
    setBusy(true)
    const { error } = await supabase.rpc('undo_manual_distribution', { p_batch_id: id })
    setBusy(false)
    if (error) { setMsg({ t: 'err', m: tr('manual.undoFailed') + ' — ' + dbErr(error.message) }); return }
    setMsg({ t: 'ok', m: tr('manual.undone') })
    loadRefs()
  }

  // ---------- الواجهة ----------
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <div className={'alert ' + (msg.t === 'ok' ? 'alert-ok' : 'alert-error')}>{msg.m}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}>

        {/* ١ — الفلاتر */}
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ fontSize: 15, marginBottom: 4 }}>{tr('manual.step1')}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
            {tr('manual.step1Hint')}
          </p>

          <div className="field">
            <label>{tr('manual.fromStages')}</label>
            <div style={{
              maxHeight: 190, overflowY: 'auto', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)', padding: 8,
            }}>
              {openStages.map(s => (
                <label key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 4px', cursor: 'pointer', fontSize: 13,
                }}>
                  <input type="checkbox" style={{ width: 16, height: 16 }}
                    checked={fromStages.includes(s.id)}
                    onChange={e => {
                      setFromStages(v => e.target.checked ? [...v, s.id] : v.filter(x => x !== s.id))
                      setMatched(null); setPreview(null)
                    }} />
                  <span>{dn(s)}</span>
                  <small style={{ color: 'var(--ink-soft)', marginInlineStart: 'auto' }}>
                    {s.board === 'coordinator' ? tr('bulk.coordsTag') : tr('exportLeads.board.sales')}
                  </small>
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{tr('lead.branch')}</label>
            <select value={branchId} onChange={e => { setBranchId(e.target.value); setMatched(null); setPreview(null) }}>
              <option value="">{tr('leads.f.allBranches')}</option>
              {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
            </select>
          </div>

          <div className="grid-2">
            <div className="field">
              <label>{tr('exportLeads.fromDate')}</label>
              <input type="date" value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setMatched(null); setPreview(null) }} />
            </div>
            <div className="field">
              <label>{tr('exportLeads.toDate')}</label>
              <input type="date" value={dateTo}
                onChange={e => { setDateTo(e.target.value); setMatched(null); setPreview(null) }} />
            </div>
          </div>

          <div className="field">
            <label>{tr('manual.stageAfter')}</label>
            <select value={toStage} onChange={e => setToStage(e.target.value)}>
              <option value="">{tr('manual.noChange')}</option>
              {openStages.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
            </select>
          </div>

          <button className="btn btn-primary" onClick={countMatches} disabled={busy}>
            {busy ? tr('chat.searching') : tr('manual.findLeads')}
          </button>

          {matched !== null && (
            <div className="alert alert-ok" style={{ marginTop: 12 }}>
              {tr('manual.foundBefore')} <b>{fmt(matched)}</b> {tr('manual.foundAfter')}
            </div>
          )}
        </div>

        {/* ٢ — الموظفون */}
        <div className="card">
          <div style={{ padding: '16px 16px 0' }}>
            <h2 style={{ fontSize: 15 }}>{tr('manual.step2')}</h2>
            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              {tr('manual.step2Hint')}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
            <button className="btn btn-ghost btn-sm" onClick={splitEqually}>{tr('manual.splitEqually')}</button>
            <button className="btn btn-ghost btn-sm" onClick={fillByWeight}>{tr('manual.byWeight')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPicked({}); setPreview(null) }}>{tr('manual.reset')}</button>
          </div>

          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{tr('common.employee')}</th><th>{tr('distTab.weight')}</th><th>{tr('team.dailyCap')}</th><th>{tr('manual.openLeads')}</th><th>{tr('manual.count')}</th></tr>
            </thead>
            <tbody>
              {agents.map(a => {
                const heavy = (load[a.id] ?? 0) >= 40
                return (
                  <tr key={a.id} style={{ opacity: picked[a.id] > 0 ? 1 : .6 }}>
                    <td style={{ fontWeight: 600 }}>
                      {salesLabel(a)}
                      {!a.in_rotation && (
                        <small style={{ color: 'var(--ink-soft)', marginInlineStart: 6 }}>({tr('manual.outOfRotation')})</small>
                      )}
                    </td>
                    <td>{a.weight}</td>
                    <td>{a.daily_cap}/{tr('installments.dayUnit')}</td>
                    <td>
                      <span className="badge" style={{
                        background: heavy ? 'var(--warn-soft)' : 'var(--line-soft)',
                        color: heavy ? 'var(--warn)' : 'var(--ink-soft)',
                      }}>
                        {fmt(load[a.id] ?? 0)}{heavy ? ' ⚠' : ''}
                      </span>
                    </td>
                    <td>
                      <input type="number" min={0} value={picked[a.id] ?? ''}
                        onChange={e => setCount(a.id, e.target.value)}
                        placeholder="0" style={{ width: 80, padding: '6px 8px' }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 16, borderTop: '1px solid var(--line)',
          }}>
            <div style={{ fontSize: 13 }}>
              {tr('manual.totalRequested')}: <b style={{ color: 'var(--gold)' }}>{fmt(totalPicked)}</b> {tr('leads.leadUnit')}
              {matched !== null && totalPicked > matched && (
                <span style={{ color: 'var(--warn)', marginInlineStart: 8 }}>
                  ({tr('manual.moreThanAvailable', { n: fmt(matched) })})
                </span>
              )}
            </div>
            <button className="btn btn-primary" style={{ marginInlineStart: 'auto' }}
              onClick={buildPreview} disabled={busy || !totalPicked}>
              {tr('manual.preview')}
            </button>
          </div>
        </div>
      </div>

      {/* ٣ — المعاينة والتأكيد */}
      {preview && (
        <div className="card" style={{ padding: 18, borderColor: 'var(--gold)' }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>{tr('manual.step3')}</h2>

          {preview.items.length === 0 ? (
            <div className="empty"><strong>{tr('manual.noMatch')}</strong></div>
          ) : (
            <>
              <table className="table">
                <thead><tr><th>{tr('common.employee')}</th><th>{tr('manual.willReceive')}</th></tr></thead>
                <tbody>
                  {preview.perUser.filter(u => u.got > 0).map(u => (
                    <tr key={u.name}>
                      <td style={{ fontWeight: 600 }}>{u.name}</td>
                      <td style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmt(u.got)} {tr('leads.leadUnit')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {preview.shortfall > 0 && (
                <div className="alert" style={{
                  background: 'var(--warn-soft)', color: 'var(--warn)', marginTop: 12,
                }}>
                  {tr('manual.shortfall', { n: fmt(preview.shortfall) })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-primary" onClick={execute} disabled={busy}>
                  {busy ? tr('manual.distributing') : tr('manual.confirmDistribute', { n: fmt(preview.items.length) })}
                </button>
                <button className="btn btn-ghost" onClick={() => setPreview(null)}>{tr('common.cancel')}</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ٤ — السجل */}
      <div className="card">
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15 }}>{tr('manual.history')}</h2>
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {tr('manual.historyHint')}
          </p>
        </div>
        {batches.length === 0 ? (
          <div className="empty"><strong>{tr('manual.noneYet')}</strong></div>
        ) : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>#</th><th>{tr('payments.date')}</th><th>{tr('manual.leadsCount')}</th><th>{tr('deals.status')}</th><th></th></tr>
            </thead>
            <tbody>
              {batches.map(b => (
                <tr key={b.id} style={{ opacity: b.undone_at ? .5 : 1 }}>
                  <td>{b.id}</td>
                  <td>{new Date(b.created_at).toLocaleString('en-US')}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(b.leads_count)}</td>
                  <td>
                    {b.undone_at
                      ? <span className="badge badge-suspended">{tr('manual.undoneBadge')}</span>
                      : <span className="badge badge-active">{tr('payments.st.active')}</span>}
                  </td>
                  <td>
                    {!b.undone_at && (
                      <button className="btn btn-danger btn-sm" onClick={() => undo(b.id)} disabled={busy}>
                        {tr('common.undo')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
