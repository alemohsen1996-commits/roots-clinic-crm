// صور إيصالات الدفعات — bucket خاص "receipts"، كل مستخدم بيرفع في فولدر باسمه
import i18n from '../i18n'
import { supabase } from '../lib/supabase'
import { dbErr } from '../lib/dbErrors'

const BUCKET = 'receipts'
const MAX_SIDE = 1600          // أقصى طول/عرض للصورة بعد التصغير
const MAX_BYTES = 5 * 1024 * 1024

// تصغير الصورة في المتصفح قبل الرفع (JPEG) — الـ PDF بيترفع زي ما هو
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? new File([blob], 'receipt.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file   // لو المتصفح ماعرفش يقرا الصورة نرفعها زي ما هي
  }
}

// بيرفع الملف ويرجّع المسار اللي يتحفظ على الدفعة
export async function uploadReceipt(file, userId) {
  if (!file) throw new Error(i18n.t('payment.err.receipt'))
  const ready = await shrinkImage(file)
  if (ready.size > MAX_BYTES) throw new Error(i18n.t('payment.err.tooBig'))
  const ext = ready.type === 'application/pdf' ? 'pdf'
    : ready.type === 'image/png' ? 'png'
    : ready.type === 'image/webp' ? 'webp'
    : ready.type === 'image/heic' ? 'heic' : 'jpg'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, ready, {
    contentType: ready.type || 'image/jpeg', upsert: false,
  })
  if (error) throw new Error(i18n.t('payment.err.uploadFailed') + ' — ' + dbErr(error.message))
  return path
}

// مسح صورة اترفعت والتسجيل فشل (عشان ماتفضلش يتيمة)
export async function discardReceipt(path) {
  if (path) await supabase.storage.from(BUCKET).remove([path])
}

// فتح الإيصال في تاب جديد برابط مؤقت (5 دقايق)
export async function openReceipt(path) {
  const win = window.open('', '_blank')   // نفتح التاب فورًا عشان المتصفح مايمنعهوش
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) {
    win?.close()
    alert(i18n.t('payment.err.openFailed'))
    return
  }
  if (win) win.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}
