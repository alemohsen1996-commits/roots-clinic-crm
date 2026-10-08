// البحث الشامل — يفتح من زر البحث أو Ctrl+K (⌘K) من أي صفحة
// بيدوّر بالاسم (مع توحيد أ/إ/آ وة/ه وى/ي) أو الجوال بأي شكل أو رقم الملف،
// وبيقول المريض فين: البورد والمرحلة والمسؤول وآخر ديل وأقرب معاينة.
//
// الصلاحيات من السيرفر (global_search):
//   المدير: الكل — السيلز: ليداته كاملة + ليدات زمايله «مكان فقط» (مقفولة)
//   المنسقة: مرضاها بس — المحاسب: اللي عليهم ديلات — البلازما: اللي عليهم باقات
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import useT from '../i18n/useT'
import { fmtNum, fmtDate, fmtClock, cur } from '../lib/format'
import './search.css'

const MIN_TEXT = 3
const MIN_DIGITS = 4
const DEBOUNCE_MS = 250

// آخر بحث — يرجع تاني لما الموظف يقفل الملف ويفتح البحث
let lastQuery = ''

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

function SearchGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  )
}

// زر في السايدبار (كمبيوتر) — شكل خانة بحث مع اختصار الكيبورد
export function SearchTrigger({ onOpen }) {
  const { t } = useT()
  return (
    <button type="button" className="gs-trigger" onClick={onOpen}>
      <SearchGlyph size={16} />
      <span className="gs-trigger-text">{t('search.placeholderShort')}</span>
      <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  )
}

// زر أيقونة في الشريط العلوي (موبايل)
export function SearchTopbarButton({ onOpen }) {
  const { t } = useT()
  return (
    <button type="button" className="gs-topbar-btn" onClick={onOpen}
      aria-label={t('search.open')} title={t('search.open')}>
      <SearchGlyph size={19} />
    </button>
  )
}

// Ctrl+K / ⌘K من أي مكان — و«/» لو المؤشر مش في خانة كتابة
export function useSearchHotkey(open) {
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        e.preventDefault(); open(); return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target
        const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
        if (!typing) { e.preventDefault(); open() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
}

const searchable = (q) => {
  const s = q.trim()
  return s.replace(/\s+/g, '').length >= MIN_TEXT || s.replace(/\D/g, '').replace(/^0+/, '').length >= MIN_DIGITS
}

// إيه اللي يتفتح لما يدوس على النتيجة — حسب الدور
function primaryTarget(r, roleCode) {
  if (r.access !== 'full') return null
  if (roleCode === 'accountant') return r.deal_id ? { kind: 'deal', id: r.deal_id } : null
  if (roleCode === 'prp_officer') {
    if (r.prp_package_id) return { kind: 'prp', id: r.prp_package_id }
    return r.deal_id ? { kind: 'deal', id: r.deal_id } : null
  }
  return { kind: 'lead', id: r.lead_id }
}

export default function GlobalSearch({ open, onClose, onPick }) {
  const { roleCode } = useAuth()
  const { t, isEn } = useT()
  const [q, setQ] = useState(lastQuery)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const reqId = useRef(0)

  // فتح: تركيز على الخانة وتحديد النص القديم (يكتب فوقه على طول)
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
    document.body.style.overflow = 'hidden'
    return () => { cancelAnimationFrame(id); document.body.style.overflow = '' }
  }, [open])

  const run = useCallback(async (text) => {
    const my = ++reqId.current
    if (!searchable(text)) { setRows([]); setLoading(false); setError(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.rpc('global_search', { p_q: text.trim(), p_limit: 20 })
    if (my !== reqId.current) return          // نتيجة قديمة — فيه بحث أحدث
    setLoading(false)
    if (err) { console.error(err); setError(true); setRows([]); return }
    setError(false)
    setRows(data ?? [])
    setActive(0)
  }, [])

  useEffect(() => {
    if (!open) return
    lastQuery = q
    const h = setTimeout(() => run(q), DEBOUNCE_MS)
    return () => clearTimeout(h)
  }, [q, open, run])

  // الصفوف اللي تتفتح (اللي مقفولة مش بتاخد تركيز الأسهم)
  const openable = useMemo(() => rows
    .map((r, i) => ({ i, target: primaryTarget(r, roleCode) }))
    .filter(x => x.target), [rows, roleCode])

  const pick = useCallback((target) => {
    if (!target) return
    onPick(target)
    onClose()
  }, [onPick, onClose])

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (!openable.length) return
    const pos = Math.max(0, openable.findIndex(x => x.i === active))
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(openable[(pos + 1) % openable.length].i)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(openable[(pos - 1 + openable.length) % openable.length].i)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick((openable.find(x => x.i === active) ?? openable[0]).target)
    }
  }

  // الصف النشط يفضل ظاهر وأنت بتتحرك بالأسهم
  useEffect(() => {
    listRef.current?.querySelector('.gs-row.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const stageLabel = (r) => (isEn && r.stage_name_en) ? r.stage_name_en : r.stage_name
  const branchLabel = (r) => (isEn && r.branch_name_en) ? r.branch_name_en : r.branch_name
  const boardLabel = (b) => b === 'coordinator' ? t('leads.coordBoard') : b === 'sales' ? t('leads.salesBoard') : ''
  const showHint = !searchable(q)

  return (
    <div className="gs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gs-panel" role="dialog" aria-modal="true" aria-label={t('search.title')}>
        <div className="gs-input-wrap">
          <SearchGlyph />
          <input
            ref={inputRef}
            className="gs-input"
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('search.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            aria-controls="gs-results"
            aria-activedescendant={rows.length ? `gs-row-${active}` : undefined}
          />
          {loading && <span className="gs-spin" aria-hidden="true" />}
          <button type="button" className="gs-close" onClick={onClose} aria-label={t('common.close')}>
            <kbd>Esc</kbd>
          </button>
        </div>

        <div className="gs-body" ref={listRef} id="gs-results" role="listbox">
          {showHint && (
            <div className="gs-empty">
              <p>{t('search.hint')}</p>
              <p className="gs-scope">{t(`search.scope.${roleCode}`, { defaultValue: '' })}</p>
            </div>
          )}

          {!showHint && error && <div className="gs-empty">{t('search.error')}</div>}

          {!showHint && !error && !loading && rows.length === 0 && (
            <div className="gs-empty">
              <p>{t('search.noResults', { q: q.trim() })}</p>
              <p className="gs-scope">{t(`search.scope.${roleCode}`, { defaultValue: '' })}</p>
            </div>
          )}

          {!showHint && rows.map((r, i) => {
            const target = primaryTarget(r, roleCode)
            const limited = r.access !== 'full'
            const stageColor = r.stage_color || 'var(--ink-soft)'
            const cls = 'gs-row' + (limited ? ' is-limited' : '') + (i === active && target ? ' is-active' : '')
            return (
              <div key={r.lead_id} id={`gs-row-${i}`} className={cls} role="option"
                aria-selected={i === active && !!target} aria-disabled={!target}
                style={{ '--stage': stageColor }}
                onMouseEnter={() => target && setActive(i)}
                onClick={() => pick(target)}>
                <div className="gs-line1">
                  <span className="gs-name">{r.full_name || '—'}</span>
                  {r.is_mine && <span className="gs-tag mine">{t('search.mine')}</span>}
                  {r.archived && <span className="gs-tag arch">{t('search.archived')}</span>}
                  {limited && (
                    <span className="gs-tag lock" title={t('search.lockedTitle')}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      {t('search.colleague')}
                    </span>
                  )}
                  <span className="gs-meta-end">
                    {limited
                      ? <span className="gs-phone masked" dir="ltr" title={t('search.maskedPhone')}>
                          <span aria-hidden="true">••••</span><span>{String(r.phone ?? '').replace(/\D/g, '')}</span>
                        </span>
                      : <span className="gs-phone" dir="ltr">{r.phone}</span>}
                    {r.file_no && <span className="gs-file" dir="ltr">{r.file_no}</span>}
                  </span>
                </div>

                <div className="gs-where">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
                  </svg>
                  {r.board && <span className="gs-board">{boardLabel(r.board)}</span>}
                  {r.board && <span className="gs-sep">›</span>}
                  <span className="gs-stage">{stageLabel(r) || t('common.notSet')}</span>
                  {r.owner_name && <span className="gs-who">{t('search.sales')}: <b>{r.owner_name}</b></span>}
                  {r.coordinator_name && <span className="gs-who">{t('search.coord')}: <b>{r.coordinator_name}</b></span>}
                  {branchLabel(r) && <span className="gs-who">{branchLabel(r)}</span>}
                </div>

                {limited ? (
                  <div className="gs-locked-note">
                    {r.owner_name ? t('search.lockedNote', { name: r.owner_name }) : t('search.lockedNoteNoOwner')}
                  </div>
                ) : (r.deal_id || r.appt_date || r.prp_package_id) ? (
                  <div className="gs-extra">
                    {r.deal_id && (
                      <button type="button" className="gs-chip" title={t('search.openDeal')}
                        onClick={(e) => { e.stopPropagation(); pick({ kind: 'deal', id: r.deal_id }) }}>
                        <span className={'gs-dot st-' + r.deal_status} />
                        {t(`dealStatus.${r.deal_status}`, { defaultValue: r.deal_status })}
                        {r.deal_total != null && (
                          <span className="gs-money">
                            <bdi dir="ltr">{fmtNum(r.deal_collected)} / {fmtNum(r.deal_total)}</bdi> {cur()}
                          </span>
                        )}
                        {r.deal_count > 1 && (
                          <span className="gs-more" title={t('search.moreDeals', { n: r.deal_count - 1 })}>
                            {t('search.moreDeals', { n: r.deal_count - 1 })}
                          </span>
                        )}
                      </button>
                    )}
                    {r.appt_date && (
                      <span className="gs-chip static">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          strokeLinecap="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
                        {fmtDate(r.appt_date)}{r.appt_time ? ' · ' + fmtClock(r.appt_time) : ''}
                        <span className="gs-sub">{t(`apptStatus.${r.appt_status}`, { defaultValue: r.appt_status })}</span>
                      </span>
                    )}
                    {r.prp_package_id && roleCode !== 'accountant' && (
                      <button type="button" className="gs-chip" title={t('search.openPrp')}
                        onClick={(e) => { e.stopPropagation(); pick({ kind: 'prp', id: r.prp_package_id }) }}>
                        {t('search.prpActive')}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="gs-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t('search.kbdMove')}</span>
          <span><kbd>Enter</kbd> {t('search.kbdOpen')}</span>
          <span><kbd>Esc</kbd> {t('search.kbdClose')}</span>
        </div>
      </div>
    </div>
  )
}
