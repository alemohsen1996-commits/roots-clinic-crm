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


// فحص التغطية: العناصر المهمة (عناوين، تبويبات، أزرار حفظ/إلغاء، أول وآخر عناصر) لازم elementFromPoint
// على نقطها يرجّع العنصر نفسه أو حاجة جواه — لو رجّع عنصر تاني (topbar, bottom-nav…) يبقى مستخبي تحته.
// phase: top = بعد السكرول لأول المحتوى، bottom = بعد السكرول لآخره. (الكيبورد مش مفتوح — المحاكي مش بيفتحه)
async function coverageEval({ rootSel, scrollerSels, phase }) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const root = document.querySelector(rootSel) || document.body
  document.documentElement.style.scrollBehavior = 'auto'
  const given = scrollerSels.map(s => document.querySelector(s)).filter(Boolean)
  const scrollers = given.length ? given
    : [document.body, document.querySelector('#root'), document.querySelector('.shell'), document.querySelector('main')]
        .filter(e => e && e.scrollHeight > e.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(e).overflowY))
  for (const sc of scrollers) sc.scrollTo({ top: phase === 'top' ? 0 : sc.scrollHeight, behavior: 'instant' })
  if (!given.length) window.scrollTo({ top: phase === 'top' ? 0 : document.documentElement.scrollHeight, behavior: 'instant' })
  await wait(350)

  const closedNav = document.querySelector('aside.sidebar:not(.open)')
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0' || cs.pointerEvents === 'none') return false
    return !(closedNav && closedNav.contains(el))
  }
  const all = (sel) => [...root.querySelectorAll(sel)].filter(vis)
  const sel = (el) => {
    let s = el.tagName.toLowerCase()
    if (el.id) return s + '#' + el.id
    const c = [...el.classList].slice(0, 2).join('.')
    return c ? s + '.' + c : s
  }
  const txt = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 28)

  const interactive = all('button, a[href], input:not([type=hidden]), select, textarea, [role=tab]')
  const heads = all('h1, h2')
  const tabs = all('.tab, [role=tab], .mstage')
  const actions = all('.modal-actions .btn, .m-action-bar .btn, .sheet-foot .btn')
  let lastLeaf = null, lb = -1
  for (const el of all('*')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
    const r = el.getBoundingClientRect()
    if (r.bottom > lb && r.bottom < innerHeight * 2) { lastLeaf = el; lb = r.bottom }
  }
  const set = new Set(phase === 'top'
    ? [...heads, ...tabs.slice(0, 3), ...interactive.slice(0, 3), ...actions]
    : [...interactive.slice(-3), ...actions, ...(lastLeaf ? [lastLeaf] : [])])

  const bad = []
  for (const el of set) {
    const r = el.getBoundingClientRect()
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1)
    for (const y of [r.top + Math.min(8, r.height / 2), r.top + r.height / 2, r.bottom - Math.min(8, r.height / 2)]) {
      if (y <= 0 || y >= innerHeight) continue
      const top = document.elementFromPoint(cx, y)
      if (!top || el === top || el.contains(top)) continue
      // مقصوص بسكرولر داخلي (زي رسايل الشات) مش متغطّي بعنصر تاني
      let clippedByScroller = false
      for (let a = el.parentElement; a && a !== root.parentElement && a !== document.body; a = a.parentElement) {
        if (scrollers.includes(a)) break
        if (/auto|scroll/.test(getComputedStyle(a).overflowY) && a.clientHeight >= 100 && a.scrollHeight > a.clientHeight + 2) {   // ≥100px: عشان .tabs المضغوط ما يتحسبش سكرولر
          const ar = a.getBoundingClientRect()
          if (r.top < ar.top || r.bottom > ar.bottom) { clippedByScroller = true; break }
        }
      }
      if (clippedByScroller) continue
      const k = top.closest('.topbar, .bottom-nav, .m-action-bar, .modal-backdrop, .drawer, .sheet, .notif-panel, .chat-lightbox, .sidebar, .modal')
      // قبل السكرول، اللي تحت الشريط السفلي لسه هيظهر؛ وبعده، اللي فوق تحت الشريط العلوي كان عدّى
      if (phase === 'top' && top.closest('.bottom-nav, .m-action-bar')) break
      if (phase === 'bottom' && top.closest('.topbar')) break
      bad.push(`${phase}: ${sel(el)} "${txt(el)}" مستخبي تحت ${k ? sel(k) : sel(top)}${k && k !== top ? ' (' + sel(top) + ')' : ''}`)
      break
    }
  }
  return [...new Set(bad)]
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
    async function capture(name, { scroller, theme, root, scrollers, modal } = {}) {
      step = name
      await settle()
      const file = path.join(dir, `${name}.png`)
      // full page، بحد أقصى 4000px (لستات الليدات بتبقى طويلة جدًا)
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      const w = await page.evaluate(() => window.innerWidth)
      await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 4000) } })
        .catch(async () => page.screenshot({ path: file }))
      const c = await page.evaluate(runChecks, { minTap })
      c.overlap = (isDesktop || modal) ? [] : await checkOverlap(page, scroller)
      // فحص التغطية: أول المحتوى ثم آخره
      const covRoot = root || scroller || 'main'
      const covScrollers = scrollers || (scroller ? [scroller] : [])
      const covered = []
      for (const phase of ['top', 'bottom']) {
        covered.push(...await page.evaluate(coverageEval, { rootSel: covRoot, scrollerSels: covScrollers, phase }).catch(() => []))
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      for (const sc of covScrollers) await page.evaluate((x) => document.querySelector(x)?.scrollTo(0, 0), sc).catch(() => {})
      const add = (kind, severity, detail) => findings.push({ role, device, page: name, kind, severity, detail, image: file.replace(/\\/g, '/') })
      if (c.hscroll) add('سكرول أفقي', 'عالية', `scrollWidth ${c.hscroll.scrollWidth} > ${c.hscroll.innerWidth}`)
      c.offscreen.forEach(d => add('عنصر بره الشاشة', 'عالية', d))
      c.overlap.forEach(d => add('شريط يغطي آخر المحتوى', 'عالية', d))
      covered.forEach(d => add('مستخبي تحت عنصر', 'عالية', d))
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

    // تخطّي متوقّع (مفيش صلاحية / مش متاح للدور) — بيتسجّل معلومة، مش فشل
    function skipStep(name, reason) {
      console.log(`  [${role}/${device}] ${name} SKIP: ${reason}`)
      findings.push({ role, device, page: name, kind: 'اتخطّت', severity: 'معلومة', detail: reason, image: '' })
    }

    async function tryStep(name, fn) {
      step = name
      const t0 = Date.now()
      try { await fn(); console.log(`  [${role}/${device}] ${name} ${Date.now() - t0}ms`) } catch (e) {
        const msg = String(e.message).split('\n')[0]
        console.log(`  [${role}/${device}] ${name} FAIL ${Date.now() - t0}ms: ${msg.slice(0, 90)}`)
        findings.push({ role, device, page: name, kind: 'خطوة فشلت', severity: 'معلومة', detail: msg.slice(0, 160), image: '' })
      }
    }


    // يفتح نافذة، يصوّرها ويفحصها، ويقفلها بـ"إلغاء" (من غير حفظ). كل صفحة بعدها بتتحمّل من جديد فمفيش حاجة بتفضل مفتوحة
    async function closeOverlay(rootSel) {
      // "إلغاء" الأول (عشان ما نقفلش الدرج بالغلط وإحنا بنلغي تعديل جواه)، وبعدين "إغلاق"
      const root = page.locator(rootSel).first()
      const cancel = root.getByRole('button', { name: /^(إلغاء|Cancel)$/ }).first()
      const close = root.getByRole('button', { name: /^(إغلاق|Close)$/ }).first()
      if (await cancel.count()) await cancel.click({ timeout: 3000 }).catch(() => {})
      else if (await close.count()) await close.click({ timeout: 3000 }).catch(() => {})
      else await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    async function modalStep(name, open, { root = '.modal', scrollers = ['.modal', '.modal-backdrop'], close = root } = {}) {
      await tryStep(name, async () => {
        await open()
        await page.locator(root).first().waitFor({ timeout: 6000 })
        await capture(name, { root, scrollers, modal: true })
        await closeOverlay(close)
      })
    }
    const plusBtn = () => page.locator('main button.btn-primary:has-text("+")').first()

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
        await capture('04-leads-filter-sheet', { root: '.sheet', scrollers: ['.sheet-body'], modal: true })
        await page.locator('.sheet-backdrop').click({ position: { x: 5, y: 5 } })
      })
    }
    await modalStep('20-modal-lead-new', () => plusBtn().click())
    await tryStep('21-modal-lead-export', async () => {
      const b = page.locator('main button:has-text("⬇")').first()
      if (!(await b.isVisible().catch(() => false))) {
        skipStep('21-modal-lead-export', 'الزر مخفي على الموبايل أو للمدراء بس'); return
      }
      await b.click()
      const root = '.drawer-backdrop .card'
      await page.locator(root).first().waitFor({ timeout: 6000 })
      await capture('21-modal-lead-export', { root, scrollers: ['.drawer-backdrop'], modal: true })
      await closeOverlay(root)
    })
    await tryStep('05-lead-drawer', async () => {
      await openFirstLead()
      await capture('05-lead-drawer', { scroller: '.drawer' })
    })
    await tryStep('22-lead-edit-data', async () => {
      await page.locator('.drawer').getByRole('button', { name: /تعديل البيانات/ }).first().click({ timeout: 5000 })
      await page.waitForTimeout(500)
      await capture('22-lead-edit-data', { scroller: '.drawer' })
      await page.locator('.drawer').getByRole('button', { name: /^إلغاء$/ }).first().click({ timeout: 4000 })   // إلغاء التعديل (مش حفظ)
      await page.waitForTimeout(400)
    })
    await tryStep('23-lead-wa-templates', async () => {
      await page.locator('.wa-tpl .icon-btn').first().click({ timeout: 5000 })
      await page.locator('.wa-tpl-menu').waitFor({ timeout: 4000 })
      await capture('23-lead-wa-templates', { root: '.wa-tpl-menu', scrollers: [], modal: true })
      await page.locator('.wa-tpl .icon-btn').first().click().catch(() => {})
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
    await modalStep('24-modal-deal-new', () => plusBtn().click())
    await tryStep('25-deal-drawer', async () => {
      await page.locator(isDesktop ? 'tbody tr' : '.mcard-main').first().click({ timeout: 6000 })
      await page.locator('.drawer').first().waitFor({ timeout: 6000 })
      await capture('25-deal-drawer', { root: '.drawer', scrollers: ['.drawer'], modal: true })
      await closeOverlay('.drawer')
    })
    await visit('/payments', '10-payments')
    await modalStep('26-modal-payment-add', () => plusBtn().click())
    await visit('/prp', '11-prp')
    await tryStep('27-prp-drawer', async () => {
      await page.locator(isDesktop ? 'tr[style*="cursor: pointer"]' : 'button.mcard-main').first().click({ timeout: 6000 })
      await page.locator('.drawer').first().waitFor({ timeout: 6000 })
      await capture('27-prp-drawer', { root: '.drawer', scrollers: ['.drawer'], modal: true })
      await closeOverlay('.drawer')
    })
    await visit('/installments', '28-installments')
    await modalStep('29-modal-schedule', () => plusBtn().click())
    await visit('/team', '30-team')
    const onTeam = new URL(page.url()).pathname === '/team'
    if (!onTeam) { skipStep('31-modal-employee-add', 'صفحة الفريق للمدراء بس'); skipStep('32-modal-bulk-reassign', 'صفحة الفريق للمدراء بس') }
    if (onTeam) await modalStep('31-modal-employee-add', () => plusBtn().click())
    if (onTeam) await modalStep('32-modal-bulk-reassign', () => page.locator('xpath=//main//button[contains(@class,"btn-primary")][contains(.,"+")]/preceding-sibling::button[1]').click())

    // ---- الشات (قراءة فقط — mark_read ممنوع بالحارس) ----
    await visit('/chat', '12-chat-list')
    await modalStep('33-modal-chat-new-direct', () => page.locator('.chat-new-btn').click())
    await tryStep('34-modal-chat-new-group', async () => {
      await page.locator('.chat-new-btn').click()
      await page.locator('.modal').first().waitFor({ timeout: 6000 })
      if ((await page.locator('.modal .tabs .tab').count()) < 2) {
        skipStep('34-modal-chat-new-group', 'الدور مش بيقدر يعمل جروب (مفيش تبويب جروب)')
        await closeOverlay('.modal'); return
      }
      await page.locator('.modal .tabs .tab').nth(1).click()
      await capture('34-modal-chat-new-group', { root: '.modal', scrollers: ['.modal', '.modal-backdrop'], modal: true })
      await closeOverlay('.modal')
    })
    await tryStep('35-modal-chat-group-info', async () => {
      await page.goto('/chat', { waitUntil: 'domcontentloaded' })
      await page.locator('.chat-item').first().waitFor({ timeout: 8000 })
      const grp = page.locator('.chat-item:has(.chat-avatar.group)').first()
      if (!(await grp.count())) {
        await page.locator('.chat-list-head .tab').nth(1).click({ timeout: 3000 }).catch(() => {})   // تبويب المراقبة (قراءة بس)
        await page.waitForTimeout(1200)
      }
      if (!(await grp.count())) {
        findings.push({ role, device, page: '35-modal-chat-group-info', kind: 'مفيش جروب', severity: 'معلومة', detail: 'مفيش جروب ظاهر للدور ده', image: '' }); return
      }
      await grp.click({ timeout: 8000 })   // أول جروب في القايمة
      await page.waitForTimeout(900)
      await page.locator('.chat-thread .chat-icon-btn:has-text("ⓘ")').click({ timeout: 6000 })
      await page.locator('.modal').first().waitFor({ timeout: 6000 })
      await capture('35-modal-chat-group-info', { root: '.modal', scrollers: ['.modal', '.modal-backdrop'], modal: true })
      await closeOverlay('.modal')
    })
    await visit('/chat', '12b-chat-list-again')
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
      await capture('15-notifications', { root: '.notif-panel', scrollers: ['.notif-scroll'], modal: true })
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
