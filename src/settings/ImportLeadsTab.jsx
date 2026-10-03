// استيراد ليدات من ملف — قالب ثابت بأربعة أعمدة
// الأعمدة: الاسم · الهاتف · الفرع (اختياري) · ملاحظة (اختياري)
// كل الليدات تدخل بتاريخ الاستيراد، والمرحلة والمسؤول والمصدر تُختار للملف كله
import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import i18n from '../i18n'
import useT from '../i18n/useT'

const BATCH = 500

// أسماء الأعمدة المقبولة في القالب (عربي/إنجليزي)
const COL = {
  name:   ['الاسم', 'اسم العميل', 'name', 'full name', 'lead name', 'last name'],
  phone:  ['الهاتف', 'الجوال', 'رقم الهاتف', 'phone', 'mobile'],
  branch: ['الفرع', 'branch'],
  notes:  ['ملاحظة', 'ملاحظات', 'notes', 'description'],
}

const norm = (s) => String(s ?? '').trim().toLowerCase()

function findCol(headers, keys) {
  const low = headers.map(norm)
  for (const k of keys) {
    const i = low.indexOf(norm(k))
    if (i !== -1) return headers[i]
  }
  for (const k of keys) {
    const i = low.findIndex(h => h.includes(norm(k)))
    if (i !== -1) return headers[i]
  }
  return ''
}

const digits = (v) => String(v ?? '').replace(/\D/g, '')

// الرقم صالح فقط بكود الدولة: لا يبدأ بصفر، وطوله معقول
function checkPhone(raw) {
  const p = digits(raw)
  // why = مفتاح ترجمة (importTab.why.*)
  if (!p) return { ok: false, why: 'empty' }
  if (p.startsWith('0')) return { ok: false, why: 'noCountryCode' }
  if (p.length < 10) return { ok: false, why: 'short' }
  if (p.length > 15) return { ok: false, why: 'long' }
  return { ok: true, phone: p }
}

export default function ImportLeadsTab() {
  const { t, dn, isEn } = useT()
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [headers, setHeaders] = useState([])

  const [stages, setStages] = useState([])
  const [sources, setSources] = useState([])
  const [branches, setBranches] = useState([])
  const [people, setPeople] = useState([])

  const [ownerMode, setOwnerMode] = useState('agent')   // agent | me | none
  const [ownerId, setOwnerId] = useState('')
  const [stageId, setStageId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [branchId, setBranchId] = useState('')

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const loadRefs = useCallback(async () => {
    const [{ data: st }, { data: so }, { data: br }, { data: pp }] = await Promise.all([
      supabase.from('stages').select('id, name_ar, name_en, board')
        .eq('is_active', true).order('sort_order'),
      supabase.from('lead_sources').select('id, name_ar, name_en').eq('is_active', true),
      supabase.from('branches').select('id, name').eq('is_active', true),
      supabase.from('profiles').select('id, full_name, roles(code)').eq('status', 'active'),
    ])
    setStages(st ?? []); setSources(so ?? []); setBranches(br ?? []); setPeople(pp ?? [])
  }, [])
  useEffect(() => { loadRefs() }, [loadRefs])

  // ---------- تحميل القالب ----------
  function downloadTemplate() {
    // القالب بلغة الواجهة — رؤوس الأعمدة بالاتنين مقبولة في الاستيراد
    const ws = XLSX.utils.aoa_to_sheet(isEn ? [
      ['Name', 'Phone', 'Branch', 'Notes'],
      ['Ahmed Mohamed', '966555512583', '', ''],
      ['Khaled Alotaibi', '966501234567', '', 'Asking about this month\'s offer'],
    ] : [
      ['الاسم', 'الهاتف', 'الفرع', 'ملاحظة'],
      ['أحمد محمد', '966555512583', '', ''],
      ['خالد العتيبي', '966501234567', '', 'يسأل عن عرض الشهر'],
    ])
    ws['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 30 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, isEn ? 'Leads' : 'الليدات')
    XLSX.writeFile(wb, isEn ? 'leads-import-template.xlsx' : 'قالب-استيراد-الليدات.xlsx')
  }

  // ---------- قراءة الملف ----------
  function onFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setErr(''); setResult(null); setDone(0); setFileName(f.name)

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        if (!data.length) { setErr(t('importTab.emptyFile')); setRows([]); return }
        setHeaders(Object.keys(data[0]))
        setRows(data)
      } catch {
        setErr(t('importTab.readFailedHint'))
        setRows([])
      }
    }
    reader.onerror = () => setErr(t('importTab.readFailed'))
    reader.readAsArrayBuffer(f)
  }

  // ---------- التحليل ----------
  const analysis = useMemo(() => {
    if (!rows.length) return null
    const cName = findCol(headers, COL.name)
    const cPhone = findCol(headers, COL.phone)
    const cBranch = findCol(headers, COL.branch)
    const cNotes = findCol(headers, COL.notes)

    if (!cPhone) return { missingPhoneCol: true }

    const branchByName = {}
    for (const b of branches) branchByName[norm(b.name)] = b.id

    const seen = new Set()
    const valid = [], bad = [], dup = []
    let branchMatched = 0, branchUnmatched = 0

    for (const r of rows) {
      const chk = checkPhone(r[cPhone])
      if (!chk.ok) { bad.push({ row: r, why: chk.why }); continue }
      if (seen.has(chk.phone)) { dup.push(r); continue }
      seen.add(chk.phone)

      let bId = null
      if (cBranch && String(r[cBranch] ?? '').trim()) {
        bId = branchByName[norm(r[cBranch])] ?? null
        bId ? branchMatched++ : branchUnmatched++
      }

      valid.push({
        full_name: String(r[cName] ?? '').trim() || t('importTab.noName'),
        phone: chk.phone,
        ...(bId ? { branch_id: bId } : {}),
        ...(cNotes && String(r[cNotes] ?? '').trim()
          ? { notes: String(r[cNotes]).trim().slice(0, 2000) } : {}),
      })
    }
    return { valid, bad, dup, cName, cPhone, cBranch, cNotes, branchMatched, branchUnmatched }
  }, [rows, headers, branches])

  // ---------- التنفيذ ----------
  async function run() {
    setErr(''); setResult(null)
    if (!analysis?.valid?.length) { setErr(t('importTab.noValidRows')); return }
    if (!stageId) { setErr(t('bulk.pickStage')); return }
    if (ownerMode === 'agent' && !ownerId) { setErr(t('importTab.pickOwner')); return }

    setBusy(true); setDone(0)
    let inserted = 0, skipped = 0
    try {
      for (let i = 0; i < analysis.valid.length; i += BATCH) {
        const chunk = analysis.valid.slice(i, i + BATCH)
        const { data, error } = await supabase.rpc('import_leads', {
          p_rows: chunk,
          p_stage_id: Number(stageId),
          p_owner_id: ownerMode === 'agent' ? ownerId : null,
          p_source_id: sourceId ? Number(sourceId) : null,
          p_branch_id: branchId ? Number(branchId) : null,
          p_no_owner: ownerMode === 'none',
        })
        if (error) throw error
        inserted += data?.inserted ?? 0
        skipped += data?.skipped ?? 0
        setDone(i + chunk.length)
      }
      setResult({ inserted, skipped, bad: analysis.bad.length, dup: analysis.dup.length })
    } catch (e) {
      setErr(t('importTab.importFailed') + ' — ' + (e.message || ''))
    }
    setBusy(false)
  }

  function reset() {
    setFileName(''); setRows([]); setHeaders([])
    setResult(null); setErr(''); setDone(0)
  }

  const agents = people.filter(p => ['agent', 'coordinator'].includes(p.roles?.code))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {err && <div className="alert alert-error">{err}</div>}

      {/* القالب */}
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>{t('importTab.template')}</h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12, lineHeight: 1.8 }}>
          {t('importTab.templateHint1')}
          <br />
          {t('importTab.templateHint2')} <span dir="ltr">966555512583</span> — {t('importTab.templateHint3')}
        </p>
        <button className="btn btn-ghost" onClick={downloadTemplate}>⬇ {t('importTab.downloadTemplate')}</button>
      </div>

      {/* الملف */}
      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>{t('importTab.upload')}</h2>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} disabled={busy} />
        {fileName && (
          <div style={{ marginTop: 10, fontSize: 13 }}>
            <b>{fileName}</b> — {t('importTab.nRows', { n: rows.length.toLocaleString('en-US') })}
            <button className="btn btn-ghost btn-sm" style={{ marginInlineStart: 10 }}
              onClick={reset} disabled={busy}>{t('importTab.changeFile')}</button>
          </div>
        )}
        {analysis?.missingPhoneCol && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {t('importTab.noPhoneCol')}
          </div>
        )}
      </div>

      {analysis && !analysis.missingPhoneCol && (
        <>
          {/* الوجهة */}
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>{t('importTab.whereTo')}</h2>

            <div className="grid-2">
              <div className="field">
                <label>{t('lead.owner')}</label>
                <select value={ownerMode} onChange={e => setOwnerMode(e.target.value)}>
                  <option value="agent">{t('importTab.specificEmployee')}</option>
                  <option value="me">{t('importTab.myAccount')}</option>
                  <option value="none">{t('leads.chips.noOwner')}</option>
                </select>
              </div>
              {ownerMode === 'agent' && (
                <div className="field">
                  <label>{t('common.employee')} *</label>
                  <select value={ownerId} onChange={e => setOwnerId(e.target.value)}>
                    <option value="">{t('common.pick')}</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="grid-2">
              <div className="field">
                <label>{t('lead.stage')} *</label>
                <select value={stageId} onChange={e => setStageId(e.target.value)}>
                  <option value="">{t('common.pick')}</option>
                  {stages.map(s => (
                    <option key={s.id} value={s.id}>
                      {dn(s)}{s.board === 'coordinator' ? ` · ${t('bulk.coordsTag')}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('lead.source')}</label>
                <select value={sourceId} onChange={e => setSourceId(e.target.value)}>
                  <option value="">{t('common.noneDash')}</option>
                  {sources.map(s => <option key={s.id} value={s.id}>{dn(s)}</option>)}
                </select>
                <small style={{ color: 'var(--ink-soft)' }}>
                  {t('importTab.sourceHint')}
                </small>
              </div>
            </div>

            <div className="field">
              <label>{t('importTab.defaultBranch')}</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">{t('common.noneDash')}</option>
                {branches.map(b => <option key={b.id} value={b.id}>{dn(b)}</option>)}
              </select>
              <small style={{ color: 'var(--ink-soft)' }}>
                {t('importTab.defaultBranchHint')}
              </small>
            </div>
          </div>

          {/* المعاينة */}
          <div className="card" style={{ padding: 18, borderColor: 'var(--gold)' }}>
            <h2 style={{ fontSize: 15, marginBottom: 12 }}>{t('importTab.review')}</h2>

            <div className="fin-grid" style={{ marginBottom: 14 }}>
              <div className="fin-gold">
                <span>{t('importTab.willImport')}</span>{analysis.valid.length.toLocaleString('en-US')} {t('leads.leadUnit')}
              </div>
              <div className={analysis.bad.length ? 'fin-danger' : ''}>
                <span>{t('importTab.rejectedNumbers')}</span>{analysis.bad.length.toLocaleString('en-US')}
              </div>
              <div><span>{t('importTab.dupInFile')}</span>{analysis.dup.length.toLocaleString('en-US')}</div>
            </div>

            {analysis.branchUnmatched > 0 && (
              <div className="alert" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
                {t('importTab.branchUnmatched', { n: analysis.branchUnmatched.toLocaleString('en-US') })}
              </div>
            )}

            {analysis.bad.length > 0 && (
              <details style={{ marginBottom: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  {t('importTab.showRejected')} ({analysis.bad.length})
                </summary>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>{t('importTab.numberAsGiven')}</th><th>{t('prpFu.reason')}</th></tr></thead>
                  <tbody>
                    {analysis.bad.slice(0, 50).map((b, i) => (
                      <tr key={i}>
                        <td className="ltr-cell">
                          {String(b.row[analysis.cPhone] ?? '') || '—'}
                        </td>
                        <td style={{ color: 'var(--danger)' }}>{t(`importTab.why.${b.why}`, { defaultValue: b.why })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {analysis.bad.length > 50 && (
                  <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                    {t('importTab.andMore')}
                  </p>
                )}
              </details>
            )}

            <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.8, marginBottom: 14 }}>
              {t('importTab.existingSkipped')}
            </p>

            {busy && (
              <div className="alert alert-ok">
                {t('importTab.importing')} {done.toLocaleString('en-US')} / {analysis.valid.length.toLocaleString('en-US')}
              </div>
            )}

            {result && (
              <div className="alert alert-ok" style={{ lineHeight: 1.9 }}>
                <b>{t('importTab.done')}</b><br />
                {t('importTab.added')}: {result.inserted.toLocaleString('en-US')} {t('leads.leadUnit')}<br />
                {t('importTab.skippedExisting')}: {result.skipped.toLocaleString('en-US')}<br />
                {t('importTab.rejected')}: {result.bad.toLocaleString('en-US')} ·
                {t('importTab.dupInFile')}: {result.dup.toLocaleString('en-US')}
              </div>
            )}

            <button className="btn btn-primary" onClick={run}
              disabled={busy || !analysis.valid.length || !stageId}>
              {busy ? t('importTab.importing') : t('importTab.importN', { n: analysis.valid.length.toLocaleString('en-US') })}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
