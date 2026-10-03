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
      {LANGS.map(l => (
        <button key={l.key} type="button" role="radio" aria-checked={lang === l.key}
          className={lang === l.key ? 'on' : ''} lang={l.key} onClick={() => choose(l.key)}>
          {compact ? l.key.toUpperCase() : l.label}
        </button>
      ))}
    </div>
  )
}
