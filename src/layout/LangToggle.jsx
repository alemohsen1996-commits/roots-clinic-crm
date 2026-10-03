// مبدّل اللغة (عربي / English) — يتطبق فورًا ويتحفظ في profiles.lang لو فيه موظف داخل
import { supabase } from '../lib/supabase'
import { LANGS, applyLang } from '../lib/lang'
import useT from '../i18n/useT'

export default function LangToggle({ compact = false, persist = false }) {
  const { t, lang } = useT()

  async function choose(k) {
    if (k === lang) return
    applyLang(k)
    if (!persist) return
    const { error } = await supabase.rpc('set_my_lang', { p_lang: k })
    if (error) console.error(error)
  }

  return (
    <div className={'lang-toggle' + (compact ? ' compact' : '')} role="radiogroup" aria-label={t('common.language')}>
      {!compact && (
        <svg className="lang-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
        </svg>
      )}
      {LANGS.map((l, i) => (
        <span key={l.key} className="lang-opt">
          {i > 0 && <i className="lang-sep" />}
          <button type="button" role="radio" aria-checked={lang === l.key}
            className={lang === l.key ? 'on' : ''} lang={l.key} onClick={() => choose(l.key)}>
            {compact ? l.key.toUpperCase() : l.label}
          </button>
        </span>
      ))}
    </div>
  )
}
