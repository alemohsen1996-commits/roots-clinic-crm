// يجمّع screenshots/_findings/*.json في screenshots/REPORT.md (جدول بكل المشاكل)
// تشغيل: node tests/e2e/make-report.mjs
import fs from 'node:fs'
import path from 'node:path'

const OUT = process.env.SHOTS_DIR || 'screenshots'
const dir = path.join(OUT, '_findings')
const rows = []
const blocked = []
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  rows.push(...j.findings)
  blocked.push(...j.blockedWrites.map(b => `${j.role}/${j.device}: ${b}`))
}
const order = { 'عالية': 0, 'متوسطة': 1, 'منخفضة': 2, 'معلومة': 3 }
rows.sort((a, b) => order[a.severity] - order[b.severity] || a.page.localeCompare(b.page))

const rel = (p) => p ? `[صورة](${p.replace(new RegExp('^' + OUT + '/'), '')})` : ''
let md = '# تقرير فحص الموبايل\n\n'
md += `عدد الملاحظات: ${rows.length}\n\n| الصفحة | الجهاز | الدور | الخطورة | النوع | التفاصيل | الصورة |\n|---|---|---|---|---|---|---|\n`
for (const r of rows) md += `| ${r.page} | ${r.device} | ${r.role} | ${r.severity} | ${r.kind} | ${String(r.detail).replace(/\|/g, '\|')} | ${rel(r.image)} |\n`
md += `\n## طلبات كتابة اتمنعت بالحارس (مفيش داتا اتعدّلت)\n\n${blocked.length ? blocked.map(b => '- ' + b).join('\n') : 'ولا طلب.'}\n`
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md)
console.log('wrote', path.join(OUT, 'REPORT.md'), rows.length, 'rows')
