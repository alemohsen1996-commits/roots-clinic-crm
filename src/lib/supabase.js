// اتصال Supabase الموحد — لا يُنشأ في أي مكان آخر
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('ضع بيانات Supabase في ملف .env — انظر .env.example')
}

export const supabase = createClient(url, key)
