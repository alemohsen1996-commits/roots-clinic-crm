// اختصار: t للترجمة، lang للغة الحالية، dn لاسم صف من الداتابيز حسب اللغة
import { useTranslation } from 'react-i18next'
import { dbName } from '../lib/lang'

export default function useT() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'ar'
  return { t, lang, isEn: lang === 'en', isRtl: lang === 'ar', dn: dbName }
}
