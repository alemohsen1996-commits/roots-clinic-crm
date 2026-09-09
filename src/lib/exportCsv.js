// تصدير CSV — مع BOM ليفتح العربي سليمًا في Excel
// محصّن ضد CSV Injection: أي قيمة تبدأ بـ = + - @ تُسبق بفاصلة عليا
// فلا ينفّذها Excel كمعادلة
export function exportCsv(filename, headers, rows) {
  const esc = (v) => {
    let s = String(v ?? '')
    // منع تنفيذ الصيغ — ثغرة معروفة عند فتح الملف في Excel
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }

  // \r\n هو فاصل الأسطر القياسي في CSV — أضمن مع نسخ Excel القديمة
  const csv = '\uFEFF' + [headers, ...rows]
    .map(r => r.map(esc).join(','))
    .join('\r\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // تأخير بسيط قبل التحرير — بعض المتصفحات تلغي التحميل إن حُرِّر فورًا
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
