// عارض الإيصال جوه الصفحة (بدل ما يفتح تاب جديد)
// صورة: تكبير/تصغير بالضغط + تدوير · PDF: معروض جوه النافذة · ← → للتنقل بين الإيصالات
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtNum, fmtDateTime } from '../lib/format'
import { receiptKind } from './receipts'
import useT from '../i18n/useT'

const urlCache = new Map()   // path -> { url, exp } عشان التنقل ذهاب وعودة مايطلبش رابط جديد كل مرة

async function signedUrl(path) {
  const hit = urlCache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 600)
  if (error || !data?.signedUrl) return null
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 540000 })
  return data.signedUrl
}

// list: الدفعات اللي ليها إيصالات بالترتيب المعروض · index: اللي اتضغط عليها
export default function ReceiptViewer({ list, index = 0, onClose }) {
  const { t, isRtl } = useT()
  const SAR = t('common.currency')
  const methodLabel = (m) => t(`payMethod.${m}`, { defaultValue: m })

  const [i, setI] = useState(index)
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [rot, setRot] = useState(0)

  const p = list[i]
  const path = p?.receipt_path
  const kind = receiptKind(path)
  const hasPrev = i > 0
  const hasNext = i < list.length - 1

  useEffect(() => {
    let alive = true
    setUrl(null); setFailed(false); setZoomed(false); setRot(0)
    if (!path) return
    signedUrl(path).then(u => {
      if (!alive) return
      if (u) setUrl(u); else setFailed(true)
    })
    return () => { alive = false }
  }, [path])

  // Esc يقفل · الأسهم للتنقل (في العربي: الشمال = التالي)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      const next = isRtl ? 'ArrowLeft' : 'ArrowRight'
      const prev = isRtl ? 'ArrowRight' : 'ArrowLeft'
      if (e.key === next && hasNext) setI(x => x + 1)
      if (e.key === prev && hasPrev) setI(x => x - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, hasNext, hasPrev, isRtl])

  if (!p) return null
  const lead = p.deals?.leads

  return (
    <div className="rv-backdrop" onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog" aria-modal="true" aria-label={t('payments.viewReceipt')}>
      <div className="rv">
        <header className="rv-head">
          <div className="rv-title">
            <b>{lead?.full_name ?? '—'}</b>
            <span>
              <span dir="ltr">{p.receipt_no}</span> · {fmtNum(p.amount)} {SAR} · {methodLabel(p.method)}
              {p.reference ? <> · <span dir="ltr">{p.reference}</span></> : null}
              {' · '}{fmtDateTime(p.paid_at)}
            </span>
          </div>
          <div className="rv-tools">
            {kind === 'image' && url && (
              <>
                <button type="button" className="icon-btn" title={t('receiptViewer.rotate')}
                  aria-label={t('receiptViewer.rotate')} onClick={() => setRot(r => (r + 90) % 360)}>⟳</button>
                <button type="button" className="icon-btn" title={zoomed ? t('receiptViewer.fit') : t('receiptViewer.zoom')}
                  aria-label={zoomed ? t('receiptViewer.fit') : t('receiptViewer.zoom')}
                  onClick={() => setZoomed(z => !z)}>{zoomed ? '⊖' : '⊕'}</button>
              </>
            )}
            {url && (
              <a className="icon-btn" href={url} target="_blank" rel="noreferrer"
                title={t('dealPays.openFull')} aria-label={t('dealPays.openFull')}>↗</a>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.close')}</button>
          </div>
        </header>

        <div className={'rv-body' + (zoomed ? ' zoomed' : '')}>
          {failed ? (
            <div className="rv-msg">{t('payment.err.openFailed')}</div>
          ) : !url ? (
            <div className="rv-msg">{t('common.loading')}</div>
          ) : kind === 'image' ? (
            <img src={url} alt={`${t('payments.receipt')} ${p.receipt_no}`}
              style={{ transform: rot ? `rotate(${rot}deg)` : undefined }}
              onClick={() => setZoomed(z => !z)} onError={() => setFailed(true)} />
          ) : kind === 'pdf' ? (
            <iframe src={url} title={`${t('payments.receipt')} ${p.receipt_no}`} />
          ) : (
            <div className="rv-msg">
              {t('receiptViewer.noPreview')}
              <a className="btn btn-primary btn-sm" href={url} target="_blank" rel="noreferrer"
                style={{ marginTop: 10 }}>{t('receiptViewer.download')}</a>
            </div>
          )}
        </div>

        {list.length > 1 && (
          <footer className="rv-foot">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasPrev}
              onClick={() => setI(x => x - 1)}>{t('common.prev')}</button>
            <span className="rv-pos">{fmtNum(i + 1)} / {fmtNum(list.length)}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hasNext}
              onClick={() => setI(x => x + 1)}>{t('common.next')}</button>
          </footer>
        )}
      </div>
    </div>
  )
}
