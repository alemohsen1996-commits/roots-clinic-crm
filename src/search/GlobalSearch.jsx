// البحث الشامل — يفتح من زر البحث أو Ctrl+K (⌘K) من أي صفحة
// بيدوّر بالاسم (مع توحيد أ/إ/آ وة/ه وى/ي) أو الجوال بأي شكل أو رقم الملف،
// وبيقول المريض فين: خط رحلته (مبيعات ← معاينة ← ديل ← عملية) والمرحلة
// والمسؤولين وآخر ديل وأقرب معاينة.
//
// الصلاحيات من السيرفر (global_search_v2):
//   المدير: الكل — السيلز: ليداته كاملة + ليدات زمايله «مكان فقط» (مقفولة)
//   المنسقة: مرضاها بس — المحاسب: اللي عليهم ديلات — البلازما: اللي عليهم باقات
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import useT from '../i18n/useT'
import { fmtNum, fmtDate, fmtClock, cur, timeAgo, openWhatsApp } from '../lib/format'
import { PhoneIcon, WaIcon } from '../components/ContactButtons'
import './search.css'

const MIN_TEXT = 3
const MIN_DIGITS = 4
const DEBOUNCE_MS = 250
const RECENT_KEY = 'gs-recent'
const RECENT_MAX = 6

// آخر بحث — يرجع تاني لما الموظف يقفل الملف ويفتح البحث
let lastQuery = ''

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')

// ---------- آخر مرضى اتفتحوا من البحث (للتبويب الحالي بس — sessionStorage) ----------
function readRecent() {
  try { return JSON.parse(sessionStorage.getItem(RECENT_KEY)) ?? [] } catch { return [] }
}
function pushRecent(r, target) {
  const item = {
    lead_id: r.lead_id, full_name: r.full_name, file_no: r.file_no,
    stage_name: r.stage_name, stage_name_en: r.stage_name_en, stage_color: r.stage_color, target,
  }
  const list = [item, ...readRecent().filter(x => x.lead_id !== r.lead_id)].slice(0, RECENT_MAX)
  try { sessionStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch {}
}

// ---------- تلوين الجزء المطابق من الاسم ----------
// نفس توحيد السيرفر (ar_norm) حرف بحرف، مع خريطة ترجع لمكان الحرف في الاسم الأصلي
const AR_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و' }
const MARKS = /[ً-ْٰـ]/
function normWithMap(s) {
  let out = ''
  const map = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (MARKS.test(ch)) continue
    const lc = ch.toLowerCase()
    out += AR_MAP[lc] ?? lc
    map.push(i)
  }
  return { out, map }
}
function highlight(text, query) {
  if (!text) return text
  const terms = normWithMap(query.trim()).out.split(/\s+/).filter(t => t.length >= 2)
  if (!terms.length) return text
  const { out, map } = normWithMap(text)
  const ranges = []
  for (const term of terms) {
    let from = 0
    for (;;) {
      const at = out.indexOf(term, from)
      if (at < 0) break
      ranges.push([map[at], map[at + term.length - 1] + 1])
      from = at + term.length
    }
  }
  if (!ranges.length) return text
  ranges.sort((a, b) => a[0] - b[0])
  const merged = [ranges[0]]
  for (const [s, e] of ranges.slice(1)) {
    const last = merged[merged.length - 1]
    if (s <= last[1]) last[1] = Math.max(last[1], e); else merged.push([s, e])
  }
  const parts = []
  let pos = 0
  merged.forEach(([s, e], k) => {
    if (s > pos) parts.push(text.slice(pos, s))
    parts.push(<mark key={k} className="gs-hl">{text.slice(s, e)}</mark>)
    pos = e
  })
  if (pos < text.length) parts.push(text.slice(pos))
  return parts
}

// ---------- خط رحلة المريض ----------
// 0 مبيعات ← 1 معاينة (بورد المنسقات) ← 2 ديل ← 3 عملية
function journeyOf(r) {
  const cat = r.stage_category
  const code = r.stage_code
  let step
  if (r.board === 'sales') step = 0
  else if (cat === 'won') step = 3
  else if (cat === 'waiting' || ['deal', 'waiting', 'repeat_procedure'].includes(code)) step = 2
  else if (cat === 'lost') step = r.deal_id ? 2 : 1
  else step = 1
  return { step, stopped: cat === 'lost', won: cat === 'won' }
}

const JOURNEY_KEYS = ['sales', 'consult', 'deal', 'surgery']

function Journey({ r }) {
  const { t, isEn } = useT()
  const { step, stopped, won } = journeyOf(r)
  const stage = (isEn && r.stage_name_en) ? r.stage_name_en : r.stage_name
  const label = t('search.journeyAria', { stage: stage || '', step: t(`search.journey.${JOURNEY_KEYS[step]}`) })
  return (
    <div className={'gs-journey' + (stopped ? ' is-stopped' : '') + (won ? ' is-won' : '')} aria-label={label} role="img">
      <div className="gs-journey-stage">{stage || t('common.notSet')}</div>
      <ol className="gs-track">
        {JOURNEY_KEYS.map((k, i) => {
          const state = i < step ? 'past' : i === step ? (stopped ? 'stop' : 'now') : 'next'
          return (
            <li key={k} className={'gs-node ' + state}>
              <span className="gs-dot-wrap">
                <span className="gs-node-dot">
                  {state === 'stop' && (
                    <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  {state === 'now' && won && (
                    <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                      <path d="M2.5 6.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </span>
              <span className="gs-node-label">{t(`search.journey.${k}`)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function SearchGlyph({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  )
}

const LockGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

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
  const [recent, setRecent] = useState(readRecent)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const reqId = useRef(0)

  // فتح: تركيز على الخانة وتحديد النص القديم (يكتب فوقه على طول)
  useEffect(() => {
    if (!open) return
    setRecent(readRecent())
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
    document.body.style.overflow = 'hidden'
    return () => { cancelAnimationFrame(id); document.body.style.overflow = '' }
  }, [open])

  const run = useCallback(async (text) => {
    const my = ++reqId.current
    if (!searchable(text)) { setRows([]); setLoading(false); setError(false); return }
    setLoading(true)
    const { data, error: err } = await supabase.rpc('global_search_v2', { p_q: text.trim(), p_limit: 20 })
    if (my !== reqId.current) return          // نتيجة قديمة — فيه بحث أحدث
    setLoading(false)
    if (err) { console.error(err); setError(true); setRows([]); return }
    setError(false)
    // ليداتك الأول، وبعدين ليدات الزملاء (مكان فقط) — مع الحفاظ على ترتيب السيرفر جوه كل مجموعة
    const list = data ?? []
    setRows([...list.filter(r => r.access === 'full'), ...list.filter(r => r.access !== 'full')])
  }, [])

  useEffect(() => {
    if (!open) return
    lastQuery = q
    const h = setTimeout(() => run(q), DEBOUNCE_MS)
    return () => clearTimeout(h)
  }, [q, open, run])

  const showRecent = q.trim() === '' && recent.length > 0
  const showHint = !showRecent && !searchable(q)

  // العناصر اللي تتفتح بالكيبورد — نتايج البحث أو «فتحتهم مؤخرًا»
  const items = useMemo(() => {
    if (showRecent) return recent.map((r, i) => ({ key: `r-${r.lead_id}`, i, target: r.target, row: null }))
    if (showHint) return []
    return rows.map((r, i) => ({ key: `s-${r.lead_id}`, i, target: primaryTarget(r, roleCode), row: r }))
  }, [showRecent, showHint, recent, rows, roleCode])
  const openable = useMemo(() => items.filter(x => x.target), [items])

  // أول عنصر يتفتح يبقى النشط مع كل نتيجة جديدة
  useEffect(() => { setActive(openable[0]?.i ?? 0) }, [openable])

  const pick = useCallback((target, row) => {
    if (!target) return
    if (row) pushRecent(row, target)
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
      const it = openable.find(x => x.i === active) ?? openable[0]
      pick(it.target, it.row)
    }
  }

  // الصف النشط يفضل ظاهر وأنت بتتحرك بالأسهم
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const branchLabel = (r) => (isEn && r.branch_name_en) ? r.branch_name_en : r.branch_name
  const stageLabel = (r) => (isEn && r.stage_name_en) ? r.stage_name_en : r.stage_name
  const fullCount = rows.filter(r => r.access === 'full').length
  const groupHeads = roleCode === 'agent' && rows.some(r => r.access !== 'full')
  const scope = t(`search.scope.${roleCode}`, { defaultValue: '' })

  return (
    <div className="gs-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gs-panel" role="dialog" aria-modal="true" aria-label={t('search.title')}>
        <div className="gs-input-wrap">
          <SearchGlyph size={20} />
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
            aria-activedescendant={openable.length ? `gs-item-${active}` : undefined}
          />
          {loading && <span className="gs-spin" aria-hidden="true" />}
          {q && !loading && (
            <button type="button" className="gs-clear" onClick={() => { setQ(''); inputRef.current?.focus() }}
              aria-label={t('search.clear')} title={t('search.clear')}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
          <button type="button" className="gs-close" onClick={onClose} aria-label={t('common.close')}>
            <kbd>Esc</kbd>
          </button>
        </div>

        <div className="gs-body" ref={listRef} id="gs-results" role="listbox">
          {/* فتحتهم مؤخرًا */}
          {showRecent && (
            <>
              <div className="gs-group">{t('search.recent')}</div>
              {recent.map((r, i) => (
                <div key={r.lead_id} id={`gs-item-${i}`} role="option" aria-selected={i === active}
                  className={'gs-recent' + (i === active ? ' is-active' : '')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r.target, null)}>
                  <svg className="gs-recent-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />
                  </svg>
                  <span className="gs-recent-name">{r.full_name}</span>
                  {r.stage_name && (
                    <span className="gs-pill" style={{ '--stage': r.stage_color || 'var(--ink-soft)' }}>
                      {stageLabel(r)}
                    </span>
                  )}
                  {r.file_no && <span className="gs-file" dir="ltr">{r.file_no}</span>}
                </div>
              ))}
            </>
          )}

          {showHint && (
            <div className="gs-empty">
              <div className="gs-empty-title">{t('search.hintTitle')}</div>
              <ul className="gs-tips">
                <li><b>{t('search.tipName')}</b><span>{t('search.tipNameEx')}</span></li>
                <li><b>{t('search.tipPhone')}</b><span>{t('search.tipPhoneEx')}</span></li>
                <li><b>{t('search.tipFile')}</b><span dir="ltr">HT-2026-19096</span></li>
              </ul>
            </div>
          )}

          {!showHint && !showRecent && error && (
            <div className="gs-empty"><div className="gs-empty-title">{t('search.error')}</div></div>
          )}

          {!showHint && !showRecent && !error && !loading && rows.length === 0 && (
            <div className="gs-empty">
              <div className="gs-empty-title">{t('search.noResults', { q: q.trim() })}</div>
              <p className="gs-empty-sub">{t('search.noResultsSub')}</p>
            </div>
          )}

          {!showHint && !showRecent && rows.map((r, i) => {
            const target = items[i]?.target
            const limited = r.access !== 'full'
            const isActive = i === active && !!target
            const branch = branchLabel(r)
            return (
              <div key={r.lead_id}>
                {groupHeads && i === 0 && fullCount > 0 && <div className="gs-group">{t('search.groupMine')}</div>}
                {groupHeads && i === fullCount && (
                  <div className="gs-group"><LockGlyph /> {t('search.groupColleagues')}</div>
                )}
                <div id={`gs-item-${i}`}
                  className={'gs-row' + (limited ? ' is-limited' : '') + (isActive ? ' is-active' : '')}
                  role="option" aria-selected={isActive} aria-disabled={!target}
                  style={{ '--stage': r.stage_color || 'var(--ink-soft)' }}
                  onMouseEnter={() => target && setActive(i)}
                  onClick={() => pick(target, r)}>

                  <div className="gs-info">
                    <div className="gs-line1">
                      <span className="gs-name">{highlight(r.full_name || '—', q)}</span>
                      {r.is_mine && <span className="gs-tag mine">{t('search.mine')}</span>}
                      {r.archived && <span className="gs-tag arch">{t('search.archived')}</span>}
                      {!limited && r.phone && (
                        <span className="gs-contact">
                          <a className="gs-icon-btn" href={`tel:${r.phone}`} title={t('lead.call')} aria-label={t('lead.call')}
                            onClick={(e) => e.stopPropagation()}><PhoneIcon /></a>
                          <button type="button" className="gs-icon-btn wa" title="WhatsApp" aria-label="WhatsApp"
                            onClick={(e) => { e.stopPropagation(); openWhatsApp(r.phone) }}><WaIcon /></button>
                        </span>
                      )}
                    </div>

                    <div className="gs-ids">
                      {limited
                        ? <span className="gs-phone masked" dir="ltr" title={t('search.maskedPhone')}>
                            <span aria-hidden="true">••••</span><span>{String(r.phone ?? '').replace(/\D/g, '')}</span>
                          </span>
                        : <span className="gs-phone" dir="ltr">{r.phone}</span>}
                      {r.file_no && <span className="gs-file" dir="ltr">{highlight(r.file_no, q)}</span>}
                      {r.last_activity && <span className="gs-ago">{t('search.lastActivity', { ago: timeAgo(r.last_activity) })}</span>}
                    </div>

                    <dl className="gs-people">
                      {r.owner_name && <div><dt>{t('search.sales')}</dt><dd>{r.owner_name}</dd></div>}
                      {r.coordinator_name && <div><dt>{t('search.coord')}</dt><dd>{r.coordinator_name}</dd></div>}
                      {branch && <div><dt>{t('search.branch')}</dt><dd>{branch}</dd></div>}
                    </dl>

                    {limited ? (
                      <div className="gs-locked-note">
                        <LockGlyph />
                        {r.owner_name ? t('search.lockedNote', { name: r.owner_name }) : t('search.lockedNoteNoOwner')}
                      </div>
                    ) : (r.deal_id || r.appt_date || r.prp_package_id) ? (
                      <div className="gs-extra">
                        {r.deal_id && (
                          <button type="button" className="gs-chip" title={t('search.openDeal')}
                            onClick={(e) => { e.stopPropagation(); pick({ kind: 'deal', id: r.deal_id }, r) }}>
                            <span className={'gs-dot st-' + r.deal_status} />
                            {t(`dealStatus.${r.deal_status}`, { defaultValue: r.deal_status })}
                            {r.deal_total != null && (
                              <span className="gs-money">
                                <bdi dir="ltr">{fmtNum(r.deal_collected)} / {fmtNum(r.deal_total)}</bdi> {cur()}
                              </span>
                            )}
                            {r.deal_count > 1 && <span className="gs-more">{t('search.moreDeals', { n: r.deal_count - 1 })}</span>}
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
                            onClick={(e) => { e.stopPropagation(); pick({ kind: 'prp', id: r.prp_package_id }, r) }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z" /></svg>
                            {t('search.prpActive')}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <Journey r={r} />
                </div>
              </div>
            )
          })}
        </div>

        <div className="gs-foot">
          <span className="gs-foot-scope">
            {!showHint && !showRecent && rows.length > 0
              ? t('search.count', { n: rows.length })
              : scope}
          </span>
          <span className="gs-keys">
            <span><kbd>↑</kbd><kbd>↓</kbd> {t('search.kbdMove')}</span>
            <span><kbd>Enter</kbd> {t('search.kbdOpen')}</span>
            <span><kbd>Esc</kbd> {t('search.kbdClose')}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
