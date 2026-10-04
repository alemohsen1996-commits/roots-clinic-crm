// فحص مظهر الموبايل — قراءة وتصوير فقط.
// الحماية: كل طلب كتابة على Supabase (غير تسجيل الدخول) بيتمنع هنا في الاختبار نفسه،
// عشان فتح محادثة أو لوحة الإشعارات ما يعدّلش علامات "اتقرت" ولا أي داتا حقيقية.
import { test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROLES = ['super_admin', 'sales_manager', 'agent', 'coordinator', 'accountant', 'prp_officer']
const OUT = process.env.SHOTS_DIR || 'screenshots'

const MUTATING_RPC = /(mark|log|send|edit|delete|remove|add|create|start|pin|set|update|insert|upsert|move|assign|clear|rename|archive|restore|register|subscribe|touch|heartbeat|presence|activate|distribute|import|reassign|close|complete|record|save|toggle|bulk|merge|cancel|approve|reject|schedule|book)/i

// يرجّع true لو الطلب يعدّل داتا
function isWrite(req) {
  const url = req.url()
  const m = req.method()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  if (/\/auth\/v1\/token/.test(url)) return false                  // تسجيل الدخول / تجديد الجلسة
  if (/\/rest\/v1\/rpc\//.test(url)) return MUTATING_RPC.test(url.split('/rpc/')[1].split('?')[0])
  return /\/(rest|storage|functions|auth)\/v1\//.test(url)         // أي كتابة تانية على Supabase
}

// ---------- فحوصات تتنفّذ جوه الصفحة ----------
function runChecks({ minTap }) {
  const vw = window.innerWidth
  const sel = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) return s + '#' + el.id
    const c = [...el.classList].slice(0, 2).join('.')
    return c ? s + '.' + c : s
  }
  const txt = (el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30)
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'
  }
  const inHScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return true
    }
    return false
  }
  const out = { hscroll: null, offscreen: [], smallTargets: [], clipped: [], overlap: [], arrows: [], dir: document.documentElement.dir }

  const sw = document.documentElement.scrollWidth
  if (sw > vw) out.hscroll = { scrollWidth: sw, innerWidth: vw }

  // القائمة الجانبية المقفولة مخفية بره الشاشة عن قصد — نتجاهلها
  const closedNav = document.querySelector('aside.sidebar:not(.open)')
  const all = [...document.body.querySelectorAll('*')].filter(el => visible(el) && !(closedNav && closedNav.contains(el)))

  // عناصر طالعة بره الشاشة أفقيًا
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'HTML', 'BODY'].includes(el.tagName)) continue
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 1 || r.left < -1) && !inHScroller(el)) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && r.width > vw) continue
      out.offscreen.push(`${sel(el)} [${Math.round(r.left)}..${Math.round(r.right)}] "${txt(el)}"`)
    }
  }
  out.offscreen = out.offscreen.slice(0, 8)

  // أزرار صغيرة في المحتوى
  const scope = document.querySelector('.drawer, aside.drawer, [role=dialog]') || document.querySelector('main') || document.body
  for (const el of scope.querySelectorAll('button, a[href], [role=button], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio])')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.top > innerHeight * 3) continue
    if ((r.width < minTap || r.height < minTap) && !el.closest('.bottom-nav')) {
      out.smallTargets.push(`${sel(el)} ${Math.round(r.width)}×${Math.round(r.height)} "${txt(el)}"`)
    }
  }
  out.smallTargets = [...new Set(out.smallTargets)].slice(0, 12)

  // نصوص مقطوعة/متداخلة
  for (const el of all) {
    if (el.children.length > 0 && !['SPAN', 'A', 'BUTTON', 'LABEL', 'SMALL', 'B', 'STRONG'].includes(el.tagName) && el.tagName !== 'DIV') continue
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
    const cs = getComputedStyle(el)
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      const ellipsis = cs.textOverflow === 'ellipsis'
      if (!ellipsis && cs.overflowX !== 'visible') out.clipped.push(`مقطوع: ${sel(el)} "${txt(el)}"`)
      else if (cs.overflowX === 'visible' && cs.whiteSpace === 'nowrap' && !inHScroller(el)) out.clipped.push(`طالع من حدوده: ${sel(el)} "${txt(el)}"`)
    }
  }
  out.clipped = out.clipped.slice(0, 8)

  // أسهم في الصفحة (للمراجعة اليدوية مع الاتجاه)
  for (const el of all) {
    if (el.children.length) continue
    const t = (el.textContent || '').trim()
    if (/^[←→‹›«»◀▶❮❯]$/.test(t) || /^[←→‹›«»]\s|\s[←→‹›«»]$/.test(t)) out.arrows.push(`${sel(el)} "${t.slice(0, 20)}" dir=${getComputedStyle(el).direction}`)
  }
  out.arrows = out.arrows.slice(0, 6)

  return out
}

// الشريط السفلي / شريط الأزرار مغطّي على آخر محتوى؟ (بعد السكرول لآخر الصفحة)
async function checkOverlap(page, scrollerSel) {
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto' })
  return page.evaluate(async (scrollerSel) => {
    const bars = [document.querySelector('.bottom-nav'), document.querySelector('.m-action-bar')]
      .filter(b => b && b.getBoundingClientRect().height > 0 && getComputedStyle(b).display !== 'none')
    if (!bars.length) return []
    if (document.querySelector('.sheet, .chat-list')) return []   // مودال / ليستة بتسكرول جواها
    // مين اللي بيسكرول فعلًا؟ (ممكن body بسبب overflow-x:hidden على html+body)
    let sc = scrollerSel ? document.querySelector(scrollerSel) : null
    if (!sc) sc = [document.body, document.querySelector('#root'), document.querySelector('.shell'), document.querySelector('main')]
      .find(e => e && e.scrollHeight > e.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(e).overflowY)) || null
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'instant' })
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    await new Promise(r => setTimeout(r, 400))
    const barTop = Math.min(...bars.map(b => b.getBoundingClientRect().top))
    const root = (sc && sc !== document.body && sc.id !== 'root') ? sc : (document.querySelector('main') || document.body)
    let last = null, lastBottom = -1
    for (const el of root.querySelectorAll('*')) {
      if (bars.some(b => b.contains(el))) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (r.bottom > lastBottom && r.bottom < innerHeight * 2) { last = el; lastBottom = r.bottom }
    }
    if (last && lastBottom > barTop + 1) {
      return [`آخر عنصر (${last.tagName.toLowerCase()}.${[...last.classList].slice(0, 2).join('.')}) أسفله ${Math.round(lastBottom)} تحت أعلى الشريط ${Math.round(barTop)}`]
    }
    return []
  }, scrollerSel).catch(() => [])
}

// ---------- الاختبار ----------
for (const role of ROLES) {
  const envKey = role.toUpperCase()
  const email = process.env[`TEST_${envKey}_EMAIL`]
  const password = process.env[`TEST_${envKey}_PASSWORD`]

  test(`audit ${role}`, async ({ browser }, testInfo) => {
    test.skip(!email || !password, `مفيش بيانات دخول لدور ${role} في .env.test`)
    const device = testInfo.project.name
    const isDesktop = device === 'desktop'
    const minTap = 40
    const dir = path.join(OUT, role, device)
    fs.mkdirSync(dir, { recursive: true })
    const findings = []
    const blocked = []

    const context = await browser.newContext(testInfo.project.use)
    const page = await context.newPage()
    let step = 'init'
    const logs = { console: [], net: [] }

    await context.route('**/*', (route) => {
      const req = route.request()
      if (isWrite(req)) { blocked.push(`${step}: ${req.method()} ${req.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`); return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }) }
      return route.continue()
    })
    page.on('console', m => { if (m.type() === 'error') logs.console.push(`${step}: ${m.text().slice(0, 200)}`) })
    page.on('pageerror', e => logs.console.push(`${step}: PAGEERROR ${String(e.message).slice(0, 200)}`))
    page.on('requestfailed', r => { if (/ABORTED|cancel/i.test(r.failure()?.errorText || '')) return; logs.net.push(`${step}: FAILED ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)} (${r.failure()?.errorText})`) })
    page.on('response', r => { if (r.status() >= 400) logs.net.push(`${step}: ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`) })

    const settle = async () => {
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(600)
    }

    // يصوّر ويفحص
    async function capture(name, { scroller, theme } = {}) {
      step = name
      await settle()
      const file = path.join(dir, `${name}.png`)
      // full page، بحد أقصى 4000px (لستات الليدات بتبقى طويلة جدًا)
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      const w = await page.evaluate(() => window.innerWidth)
      await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 4000) } })
        .catch(async () => page.screenshot({ path: file }))
      const c = await page.evaluate(runChecks, { minTap })
      c.overlap = isDesktop ? [] : await checkOverlap(page, scroller)
      await page.evaluate(() => window.scrollTo(0, 0))
      const add = (kind, severity, detail) => findings.push({ role, device, page: name, kind, severity, detail, image: file.replace(/\\/g, '/') })
      if (c.hscroll) add('سكرول أفقي', 'عالية', `scrollWidth ${c.hscroll.scrollWidth} > ${c.hscroll.innerWidth}`)
      c.offscreen.forEach(d => add('عنصر بره الشاشة', 'عالية', d))
      c.overlap.forEach(d => add('شريط يغطي آخر المحتوى', 'عالية', d))
      c.clipped.forEach(d => add('نص مقطوع', 'متوسطة', d))
      if (!isDesktop) c.smallTargets.forEach(d => add('زر أصغر من 40px', 'منخفضة', d))
      c.arrows.forEach(d => add('سهم (راجع الاتجاه)', 'معلومة', `${d} | dir=${c.dir}`))
      if (c.dir !== 'rtl' && !theme) add('اتجاه الصفحة', 'معلومة', `html dir=${c.dir}`)
    }

    async function visit(url, name, opts) {
      step = name
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await settle()
      const final = new URL(page.url()).pathname
      if (final !== new URL(url, 'http://x').pathname) findings.push({ role, device, page: name, kind: 'تحويل (مفيش صلاحية؟)', severity: 'معلومة', detail: `${url} → ${final}`, image: '' })
      await capture(name, opts)
    }

    async function tryStep(name, fn) {
      step = name
      try { await fn() } catch (e) { findings.push({ role, device, page: name, kind: 'خطوة فشلت', severity: 'معلومة', detail: String(e.message).split('\n')[0].slice(0, 160), image: '' }) }
    }

    // 1) صفحة الدخول (من غير تسجيل)
    await visit('/login', '01-login')

    // 2) تسجيل الدخول
    step = 'login'
    await page.fill('#email', email)
    await page.fill('#pass', password)
    await page.click('button.auth-submit')
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
    await settle()
    // اللغة عربي دايمًا والثيم الافتراضي
    await page.evaluate(() => { try { localStorage.setItem('theme', 'default') } catch {} })

    // 3) الصفحات الأساسية
    await visit('/', '02-home')

    // ---- الليدات ----
    await visit('/leads', '03-leads-board')
    const openFirstLead = async () => {
      const card = page.locator(isDesktop ? '.lead-card' : '.mlead-main').first()
      await card.waitFor({ timeout: 8000 })
      await card.click()
      await page.locator('aside.drawer, .drawer').first().waitFor({ timeout: 8000 })
    }
    if (!isDesktop) {
      await tryStep('04-leads-filter-sheet', async () => {
        await page.locator('.m-filter-btn').click()
        await page.locator('.sheet').waitFor()
        await capture('04-leads-filter-sheet')
        await page.locator('.sheet-backdrop').click({ position: { x: 5, y: 5 } })
      })
    }
    await tryStep('05-lead-drawer', async () => {
      await openFirstLead()
      await capture('05-lead-drawer', { scroller: '.drawer' })
    })
    if (!isDesktop) {
      await tryStep('06-lead-move-stage-bar', async () => {
        // الضغط بيعمل scroll + focus على خانة المرحلة بس — مفيش تغيير للمرحلة
        await page.locator('.m-action-bar .btn-primary').click()
        await page.waitForTimeout(700)
        await capture('06-lead-move-stage-bar', { scroller: '.drawer' })
        await page.keyboard.press('Escape')
      })
    }
    await page.goto('about:blank')

    // ---- باقي الصفحات ----
    await visit('/tasks', '07-tasks')
    await visit('/appointments', '08-appointments')
    await visit('/deals', '09-deals')
    await visit('/payments', '10-payments')
    await visit('/prp', '11-prp')

    // ---- الشات (قراءة فقط — mark_read ممنوع بالحارس) ----
    await visit('/chat', '12-chat-list')
    await tryStep('13-chat-thread', async () => {
      await page.locator('.chat-item').first().click({ timeout: 6000 })
      await page.waitForTimeout(1200)
      await capture('13-chat-thread')
    })

    // ---- لوحة الإشعارات ----
    await visit('/', '14-home-for-bell')
    await tryStep('15-notifications', async () => {
      const bell = page.locator('.bell-btn:visible').first()
      await bell.click({ timeout: 6000 })
      await page.locator('.notif-panel').waitFor({ timeout: 6000 })
      await capture('15-notifications')
      await page.keyboard.press('Escape')
    })

    // ---- الثيم الليلي: الليدات والمهام ----
    await page.evaluate(() => { try { localStorage.setItem('theme', 'dark') } catch {} })
    await page.goto('/leads', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await capture('16-leads-dark', { theme: true })
    await tryStep('17-lead-drawer-dark', async () => {
      await openFirstLead()
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await capture('17-lead-drawer-dark', { scroller: '.drawer', theme: true })
    })
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await capture('18-tasks-dark', { theme: true })

    // ---- تجميع النتائج ----
    for (const l of logs.console) findings.push({ role, device, page: l.split(':')[0], kind: 'خطأ console', severity: 'متوسطة', detail: l.slice(l.indexOf(':') + 2), image: '' })
    for (const l of logs.net) findings.push({ role, device, page: l.split(':')[0], kind: 'طلب شبكة فاشل', severity: 'متوسطة', detail: l.slice(l.indexOf(':') + 2), image: '' })
    const guard = [...new Set(blocked)]
    fs.mkdirSync(path.join(OUT, '_findings'), { recursive: true })
    fs.writeFileSync(path.join(OUT, '_findings', `${role}-${device}.json`), JSON.stringify({ role, device, findings, blockedWrites: guard }, null, 2))
    await context.close()
  })
}
