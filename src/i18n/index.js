// تهيئة i18next — النصوص في ar.json / en.json (مقسّمة بالشاشة)
// اللغة الابتدائية من localStorage (نفس المفتاح اللي بيقرأه index.html قبل تحميل React)
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from './ar.json'
import en from './en.json'

let initial = 'ar'
try { if (localStorage.getItem('lang') === 'en') initial = 'en' } catch {}

i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },   // React بيعمل escape لوحده
  returnNull: false,
})

export default i18n
