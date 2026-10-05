// اختبار التحديث اللحظي (Broadcast من الداتابيز) — بيعدّل ليد واحد بس: "ليد تجربة" HT-2026-15224
// ويرجّعه لمرحلته الأصلية في الآخر.
//
// تشغيل (مقفول افتراضيًا عشان ما يتشغّلش بالغلط مع باقي الاختبارات):
//   RT_TEST=1 npx playwright test realtime --workers=1
//
// الحارس: أي طلب كتابة على Supabase بيتمنع ويتسجّل، إلا اللي هدفه الليد ده بالذات
// (id=eq.<id> أو lead_id=eq.<id> أو body فيه lead_id/id بتاعه) — وبس أثناء النقل (state.allowWrites).
import { test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ENABLED = process.env.RT_TEST === '1'
const FILE_NO = 'HT-2026-15224'
const EMAIL = process.env.TEST_SUPER_ADMIN_EMAIL
const PASS = process.env.TEST_SUPER_ADMIN_PASSWORD
const OUT = path.join(process.env.SHOTS_DIR || 'screenshots', '_realtime')
const SLA_MS = 3000
fs.mkdirSync(OUT, { recursive: true })

const MUTATING_RPC = /(mark|log|send|edit|delete|remove|add|create|start|pin|set|update|insert|upsert|move|assign|clear|rename|archive|restore|register|subscribe|touch|heartbeat|presence|activate|distribute|import|reassign|close|complete|record|save|toggle|bulk|merge|cancel|approve|reject|schedule|book)/i

function isWrite(req) {
  const url = req.url(), m = req.method()
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false
  if (/\/auth\/v1\/token/.test(url)) return false
  if (/\/rest\/v1\/rpc\//.test(url)) return MUTATING_RPC.test(url.split('/rpc/')[1].split('?')[0])
  return /\/(rest|storage|functions|auth)\/v1\//.test(url)
}

// الطلب ده هدفه الليد بالذات؟ (URL فيه id/lead_id، أو body كله بيشاور على الليد ده)
function targetsLead(req, id) {
  if (!id) return false
  if (new RegExp(`[?&](id|lead_id)=eq\\.${id}(&|$)`).test(req.url())) return true
  const body = req.postData()
  if (!body) return false
  const hit = (v) => {
    if (Array.isArray(v)) return v.length > 0 && v.every(hit)
    if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => ((/lead/i.test(k) || k === 'id') && String(x) === String(id)) || (x && typeof x === 'object' && hit(x)))
    return false
  }
  try { return hit(JSON.parse(body)) } catch { return false }
}

async function guard(ctx, name, state, log) {
  await ctx.route('**/*', (route) => {
    const req = route.request()
    if (/\.supabase\.co\//.test(req.url())) log.routed = (log.routed || 0) + 1
    if (process.env.RT_DEBUG && req.method() !== 'GET') console.log('  [guard]', name, req.method(), req.url().slice(0, 90), 'write=' + isWrite(req), 'allow=' + state.allowWrites, 'lead=' + state.leadId)
    if (!isWrite(req)) return route.continue()
    const short = `${req.method()} ${req.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110)}`
    if (state.allowWrites && targetsLead(req, state.leadId)) { log.allowed.push(`${name}: ${short}`); return route.continue() }
    log.blocked.push(`${name}: ${short}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
}

// تسجيل فريمات الـ websocket (من غير access_token). payload: string (JSON) أو Buffer (binary)
function makeRec(store) {
  return (dir, payload) => {
    if (typeof payload !== 'string') {
      // binary: realtime-js 2.x بيبعت/يستقبل user broadcast بالشكل ده (kind 4 من السيرفر، kind 3 من العميل)
      const b = Buffer.from(payload)
      if (b[0] === 4) {
        const [ts, es, ms, enc] = [b[1], b[2], b[3], b[4]]
        let o = 5
        const topic = b.subarray(o, o + ts).toString(); o += ts
        const ev = b.subarray(o, o + es).toString(); o += es
        o += ms
        const body = b.subarray(o).toString()
        let pl; try { pl = enc === 1 ? JSON.parse(body) : `(binary ${b.length - o}B)` } catch { pl = body.slice(0, 120) }
        store.frames.push({ t: Date.now(), dir, sock: store.sockets.length, topic, event: 'broadcast', payload: { event: ev, payload: pl, type: 'broadcast' }, binary: true })
      } else {
        store.frames.push({ t: Date.now(), dir, sock: store.sockets.length, topic: '?', event: `(binary kind ${b[0]}, ${b.length}B)`, payload: {} })
      }
      return
    }
    let m
    try { m = JSON.parse(payload) } catch { return }
    let fr = Array.isArray(m) ? { join_ref: m[0], ref: m[1], topic: m[2], event: m[3], payload: m[4] } : m
    fr = JSON.parse(JSON.stringify(fr, (k, v) => (k === 'access_token' ? '…' : v)))
    if (fr.event === 'heartbeat' || fr.topic === 'phoenix') return
    store.frames.push({ t: Date.now(), dir, sock: store.sockets.length, ...fr })
  }
}

function wsLog(page, store) {
  const rec = makeRec(store)
  page.on('websocket', (ws) => {
    if (!/\/realtime\/v1\/websocket/.test(ws.url())) return
    const sock = { opened: Date.now(), closed: null }
    store.sockets.push(sock)
    ws.on('framesent', f => rec('out', f.payload))
    ws.on('framereceived', f => rec('in', f.payload))
    ws.on('close', () => { sock.closed = Date.now() })
  })
}

// بروكسي websocket: بيسجّل الفريمات وبيخلّينا نقطع الاتصال فعلًا (setOffline لوحده بيسيب الـWS المفتوح شغّال)
// net.offline=true → الـsockets الحية بتتقفل والاتصالات الجديدة بتتقفل فورًا لحد ما النت يرجع
async function wsProxy(page, store, net) {
  const rec = makeRec(store)
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (net.offline) { ws.close(); return }
    const sock = { opened: Date.now(), closed: null }
    store.sockets.push(sock)
    const server = ws.connectToServer()
    const entry = { ws, server }
    net.live.add(entry)
    ws.onMessage((m) => { rec('out', m); server.send(m) })
    server.onMessage((m) => { rec('in', m); ws.send(m) })
    ws.onClose(() => { sock.closed = Date.now(); net.live.delete(entry); server.close().catch(() => {}) })
    server.onClose(() => { ws.close().catch(() => {}) })
  })
}
async function cutNetwork(ctx, net) {
  net.offline = true
  for (const e of [...net.live]) { await e.server.close().catch(() => {}); await e.ws.close().catch(() => {}) }
  net.live.clear()
  await ctx.setOffline(true)
}
async function restoreNetwork(ctx, net) { net.offline = false; await ctx.setOffline(false) }

// الانضمامات (phx_join) ونتيجتها
function joinsOf(store) {
  return store.frames.filter(f => f.dir === 'out' && f.event === 'phx_join').map(j => {
    const reply = store.frames.find(f => f.dir === 'in' && f.event === 'phx_reply' && f.topic === j.topic && f.ref === j.ref)
    return { topic: j.topic, ok: reply?.payload?.status === 'ok', pc: j.payload?.config?.postgres_changes ?? [], t: j.t }
  })
}
const pcOnCrmTables = (joins) => joins.flatMap(j => j.pc.filter(p => /^(leads|payments|appointments)$/.test(p.table)).map(p => `${j.topic}:${p.table}`))
const broadcastsIn = (store, ev, since = 0) => store.frames.filter(f => f.dir === 'in' && f.event === 'broadcast' && f.payload?.event === ev && f.t >= since)

function findLead(v) {
  if (Array.isArray(v)) { for (const x of v) { const r = findLead(x); if (r) return r } return null }
  if (v && typeof v === 'object') {
    if (v.file_no === FILE_NO && v.id != null) return v
    for (const x of Object.values(v)) { const r = findLead(x); if (r) return r }
  }
  return null
}

function report(id, title, data) {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ id, title, ...data }, null, 2))
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.json')).sort()
  let md = '# تقرير اختبار التحديث اللحظي (Broadcast)\n\n'
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))
    md += `## ${d.title}\n\n| الخطوة | النتيجة | الزمن | ملاحظات |\n|---|---|---|---|\n`
    for (const r of d.results) md += `| ${r.step} | ${r.ok ? '✅ نجح' : '❌ فشل'} | ${r.ms} ms | ${String(r.note || '').replace(/\|/g, '\\|')} |\n`
    md += `\n**أخطاء console:** ${d.consoleErrors.length ? '\n' + d.consoleErrors.map(e => '- ' + e).join('\n') : 'مفيش'}\n`
    md += `\n**كتابات اتسمح بيها (الليد التجريبي بس):** ${d.allowed.length ? '\n' + d.allowed.map(e => '- ' + e).join('\n') : 'ولا واحدة'}\n`
    md += `\n**كتابات اتمنعت:** ${d.blocked.length ? '\n' + [...new Set(d.blocked)].map(e => '- ' + e).join('\n') : 'ولا واحدة'}\n`
    if (d.results.some(r => !r.ok) && d.frames?.length) {
      md += `\n**فريمات وصلت فعلًا (آخر ${d.frames.length}):**\n\n\`\`\`\n${d.frames.join('\n')}\n\`\`\`\n`
    }
    md += '\n'
  }
  fs.writeFileSync(path.join(path.dirname(OUT), 'REALTIME_REPORT.md'), md)
}

// ملخص فريم للعرض
const brief = (f) => `${new Date(f.t).toISOString().slice(11, 23)} ${f.dir} ${f.topic} ${f.event}${f.event === 'broadcast' ? '/' + f.payload?.event + ' ' + JSON.stringify(f.payload?.payload ?? {}) : ''}`

async function login(page, log) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.fill('#email', EMAIL)
  await page.fill('#pass', PASS)
  await page.click('button.auth-submit')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForTimeout(1500)
  // فحص أمان: لو الحارس ما شافش ولا طلب Supabase يبقى مش بيحمي (زي WebKit مع الـservice worker)
  if (log && !log.routed) throw new Error('الحارس ما شافش أي طلب Supabase — الحماية مش شغّالة، وقفت')
}

// أدوات بورد الكمبيوتر
const colsOf = (page, name) => page.evaluate((nm) => [...document.querySelectorAll('.kanban-col')]
  .filter(c => [...c.querySelectorAll('.lead-card .lead-name')].some(n => n.textContent.trim() === nm))
  .map(c => c.querySelector('.kanban-head .name')?.textContent.trim()), name)

async function searchOnBoard(page, boardIdx = 0) {
  await page.goto('/leads', { waitUntil: 'domcontentloaded' })
  await page.locator('.board-tabs button').nth(boardIdx).click({ timeout: 15000 }).catch(() => {})
  await page.locator('.filter-search').first().fill(FILE_NO)
  await page.waitForTimeout(2500)
}

const stripName = (s) => s.replace(/\s*[←→].*$/, '').trim()

// مين الأهداف المسموحة (مراحل عادية من غير شروط إضافية)
function pickTargets(options, origValue) {
  const ok = options.filter(o => String(o.value) !== String(origValue) && !/[←→]/.test(o.text) && /^(تم التواصل|مهتم|لا يرد)/.test(o.text.trim()))
  return ok
}

// فتح الليد عند A (بورد الكمبيوتر) وقراءة المراحل
async function openLeadA(page) {
  await page.locator('.lead-card').first().click({ timeout: 15000 })
  await page.locator('#lead-stage-box select').first().waitFor({ timeout: 15000 })
  return page.evaluate(() => {
    const s = document.querySelector('#lead-stage-box select')
    return { value: s.value, options: [...s.options].map(o => ({ value: o.value, text: o.textContent.trim() })), leadName: document.querySelector('.drawer h2')?.textContent.trim() }
  })
}

async function moveTo(page, state, value) {
  await page.locator('#lead-stage-box select').first().selectOption(String(value))
  state.allowWrites = true
  try {
    const tClick = Date.now()
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'PATCH' && /\/rest\/v1\/leads\?/.test(r.url()), { timeout: 15000 }),
      page.locator('#lead-stage-box .stage-row .btn-primary').click({ timeout: 8000 }),
    ])
    const tPatch = Date.now()
    if (!resp.ok()) throw new Error(`PATCH رجّع ${resp.status()}`)
    await page.waitForTimeout(2500)   // نسيب المتابعات (appointments…) تعدّي من الحارس
    return { tClick, tPatch }
  } finally { state.allowWrites = false }
}

// ===================================================================
test.describe('realtime', () => {
  test.skip(!ENABLED, 'اختبار بيكتب على ليد تجريبي — شغّله بـ RT_TEST=1')

  // ----- 2 + 3: كمبيوتر (A و B) -----
  test('desktop A/B', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'كمبيوتر 1440×900 بس')
    test.skip(!EMAIL || !PASS, 'مفيش حساب super_admin')
    const results = [], consoleErrors = [], log = { allowed: [], blocked: [] }
    const state = { leadId: null, allowWrites: false }
    const storeA = { frames: [], sockets: [] }, storeB = { frames: [], sockets: [] }
    let ctxA, ctxB, pageA, pageB
    let orig = null, currentValue = null, leadName = null, boardIdx = 0
    let T1, T2

    const step = async (name, fn) => {
      const t0 = Date.now()
      try { const note = await fn(); results.push({ step: name, ok: true, ms: Date.now() - t0, note: note || '' }); return true }
      catch (e) { results.push({ step: name, ok: false, ms: Date.now() - t0, note: String(e.message).split('\n')[0].slice(0, 220) }); return false }
    }
    let phase = 'init'
    const watch = (page, who) => {
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${who}/${phase}] ${m.text().slice(0, 180)}`) })
      page.on('pageerror', e => consoleErrors.push(`[${who}/${phase}] PAGEERROR ${String(e.message).slice(0, 180)}`))
    }

    try {
      ctxA = await browser.newContext(testInfo.project.use); ctxB = await browser.newContext(testInfo.project.use)
      await guard(ctxA, 'A', state, log); await guard(ctxB, 'B', state, log)
      pageA = await ctxA.newPage(); pageB = await ctxB.newPage()
      const netB = { offline: false, live: new Set() }
      wsLog(pageA, storeA); await wsProxy(pageB, storeB, netB); watch(pageA, 'A'); watch(pageB, 'B')
      pageA.on('response', async (r) => {
        if (state.leadId || !/\/rest\/v1\//.test(r.url())) return
        try { const f = findLead(await r.json()); if (f) { state.leadId = String(f.id); state.leadName = f.full_name } } catch {}
      })

      // أ + ب: دخول + بحث برقم الملف
      phase = 'setup'
      const okSetup = await step('ب) A و B يفتحوا /leads ويدوّروا برقم الملف', async () => {
        await Promise.all([login(pageA, log), login(pageB, log)])
        await searchOnBoard(pageA, 0)
        if (!(await pageA.locator('.lead-card').count())) { boardIdx = 1; await searchOnBoard(pageA, 1) }
        await searchOnBoard(pageB, boardIdx)
        if (!state.leadId) throw new Error('ما لقيتش id الليد من ردود الشبكة')
        await pageA.locator('.lead-card').first().waitFor({ timeout: 10000 })
        await pageB.locator('.lead-card').first().waitFor({ timeout: 10000 })
        return `leadId=${state.leadId} البورد=${boardIdx === 0 ? 'مبيعات' : 'منسقات'}`
      })
      if (!okSetup) throw new Error('setup فشل')

      // ج: فريمات الاشتراك
      await step('ج) انضمام ناجح لـ crm:role:super_admin و crm:all و chat:u:<id> (A و B) ومفيش postgres_changes على leads/payments/appointments', async () => {
        const notes = []
        for (const [who, st] of [['A', storeA], ['B', storeB]]) {
          const js = joinsOf(st)
          const need = [['realtime:crm:role:super_admin', (t) => t === 'realtime:crm:role:super_admin'], ['realtime:crm:all', (t) => t === 'realtime:crm:all'], ['realtime:chat:u:<id>', (t) => /^realtime:chat:u:[0-9a-f-]{36}$/.test(t)]]
          for (const [label, fn] of need) {
            const j = js.filter(x => fn(x.topic))
            if (!j.length) throw new Error(`${who}: مفيش phx_join لـ ${label}`)
            if (!j.some(x => x.ok)) throw new Error(`${who}: انضمام ${label} ما نجحش`)
          }
          const bad = pcOnCrmTables(js)
          if (bad.length) throw new Error(`${who}: لسه فيه postgres_changes: ${bad.join(', ')}`)
          notes.push(`${who}: ${js.filter(x => x.ok).length}/${js.length} انضمام ناجح`)
        }
        return notes.join(' — ')
      })

      // د: A يفتح الليد وينقله
      phase = 'move1'
      let t1 = null
      const okMove = await step('د) A يفتح الليد وينقله لمرحلة تانية', async () => {
        const info = await openLeadA(pageA)
        orig = { value: info.value, name: stripName(info.options.find(o => o.value === info.value)?.text ?? '?') }
        currentValue = info.value; leadName = info.leadName
        const targets = pickTargets(info.options, info.value)
        if (targets.length < 2) throw new Error('مفيش مرحلتين عاديتين متاحتين في القايمة: ' + info.options.map(o => o.text).join(' | '))
        T1 = targets[0]; T2 = targets[1]
        t1 = await moveTo(pageA, state, T1.value)
        currentValue = T1.value
        return `من "${orig.name}" (${orig.value}) إلى "${stripName(T1.text)}" (${T1.value})`
      })
      if (!okMove) throw new Error('النقل فشل')

      // هـ: B بدون reload
      let tSeen = null
      await step('هـ) في B من غير reload: الكارت يختفي من العمود القديم ويظهر في الجديد (< 3 ثواني)', async () => {
        await pageB.waitForFunction(([nm, to]) => {
          const cols = [...document.querySelectorAll('.kanban-col')].filter(c => [...c.querySelectorAll('.lead-card .lead-name')].some(n => n.textContent.trim() === nm)).map(c => c.querySelector('.kanban-head .name')?.textContent.trim())
          return cols.length === 1 && cols[0] === to
        }, [leadName, stripName(T1.text)], { timeout: 20000, polling: 50 })
        tSeen = Date.now()
        const ms = tSeen - t1.tPatch
        await pageB.screenshot({ path: path.join(OUT, 'desktop-B-after-move.png') }).catch(() => {})
        if (ms > SLA_MS) throw new Error(`وصل بعد ${ms}ms (> ${SLA_MS}ms) من رد الحفظ`)
        return `ظهر في "${stripName(T1.text)}" بعد ${ms}ms من رد الحفظ (${tSeen - t1.tClick}ms من الضغطة)`
      })

      // و: فريم broadcast
      await step('و) B استقبل broadcast event=crm_leads بـ id و stage_id و old_stage_id صح', async () => {
        const fr = broadcastsIn(storeB, 'crm_leads', t1.tClick - 50).filter(f => String(f.payload?.payload?.id) === state.leadId)
        if (!fr.length) throw new Error('مفيش فريم crm_leads للليد ده وصل B')
        const p = fr[0].payload.payload
        if (String(p.stage_id) !== String(T1.value)) throw new Error(`stage_id=${p.stage_id} المتوقع ${T1.value}`)
        if (String(p.old_stage_id) !== String(orig.value)) throw new Error(`old_stage_id=${p.old_stage_id} المتوقع ${orig.value}`)
        return `قناة ${fr[0].topic} | ${JSON.stringify(p)} | وصل بعد ${fr[0].t - t1.tPatch}ms من رد الحفظ`
      })

      // ز: إعادة الاتصال
      phase = 'offline'
      const online = { t: null }
      const okOff = await step('ز) B ينقطع فعلًا (WS + HTTP) 10 ثواني، A ينقل الليد، النت يرجع — B يعمل resync لوحده والكارت في مكانه', async () => {
        const framesBefore = storeB.frames.length
        await cutNetwork(ctxB, netB)
        await pageB.waitForTimeout(10000)
        await moveTo(pageA, state, T2.value)
        currentValue = T2.value
        await pageB.waitForTimeout(1500)
        const during = await colsOf(pageB, leadName)
        const gotWhileOffline = storeB.frames.slice(framesBefore).filter(f => f.dir === 'in' && f.payload?.event === 'crm_leads').length
        const socketsBefore = storeB.sockets.length
        online.t = Date.now()
        await restoreNetwork(ctxB, netB)
        await pageB.waitForFunction(([nm, to]) => {
          const cols = [...document.querySelectorAll('.kanban-col')].filter(c => [...c.querySelectorAll('.lead-card .lead-name')].some(n => n.textContent.trim() === nm)).map(c => c.querySelector('.kanban-head .name')?.textContent.trim())
          return cols.length === 1 && cols[0] === to
        }, [leadName, stripName(T2.text)], { timeout: 90000, polling: 100 })
        const ms = Date.now() - online.t
        const rejoin = joinsOf(storeB).filter(j => j.t >= online.t - 100 && j.ok).map(j => j.topic.replace('realtime:', ''))
        await pageB.screenshot({ path: path.join(OUT, 'desktop-B-after-reconnect.png') }).catch(() => {})
        if (!rejoin.length) throw new Error('الكارت اتحدّث بس مفيش phx_join بعد رجوع النت (الـWS ما اتعاد اتصاله؟)')
        if (during.length !== 1 || during[0] !== stripName(T1.text)) throw new Error(`أوفلاين الكارت كان المفروض يفضل في "${stripName(T1.text)}" بس كان في "${during.join(',') || 'مش ظاهر'}"`)
        return `أوفلاين: الكارت فضل في "${during[0]}" (فريمات crm_leads وصلت وهو مقطوع: ${gotWhileOffline})، بعد رجوع النت ظهر في "${stripName(T2.text)}" بعد ${ms}ms | sockets جديدة: ${storeB.sockets.length - socketsBefore} | إعادة انضمام: ${rejoin.join(', ')}`
      })
      await restoreNetwork(ctxB, netB).catch(() => {})

      // ح: رجوع الليد
      phase = 'restore'
      await step('ح) رجوع الليد لمرحلته الأصلية من A والتأكد إنها ظهرت في B', async () => {
        if (currentValue === orig.value) return 'كان في مكانه أصلًا'
        const m = await moveTo(pageA, state, orig.value)
        currentValue = orig.value
        await pageB.waitForFunction(([nm, to]) => {
          const cols = [...document.querySelectorAll('.kanban-col')].filter(c => [...c.querySelectorAll('.lead-card .lead-name')].some(n => n.textContent.trim() === nm)).map(c => c.querySelector('.kanban-head .name')?.textContent.trim())
          return cols.length === 1 && cols[0] === to
        }, [leadName, orig.name], { timeout: 30000, polling: 50 })
        return `رجع "${orig.name}" وظهر في B بعد ${Date.now() - m.tPatch}ms من رد الحفظ`
      })
      void okOff
    } catch (e) {
      results.push({ step: 'خطأ عام', ok: false, ms: 0, note: String(e.message).split('\n')[0].slice(0, 220) })
    } finally {
      // ضمان: الليد يرجع لمرحلته الأصلية حتى لو الاختبار وقع في النص
      try {
        if (ctxB) await ctxB.setOffline(false).catch(() => {})
        if (orig && currentValue !== orig.value && pageA) {
          if (!(await pageA.locator('#lead-stage-box select').count().catch(() => 0))) { await searchOnBoard(pageA, boardIdx); await openLeadA(pageA) }
          await moveTo(pageA, state, orig.value); currentValue = orig.value
          results.push({ step: 'تنظيف: رجوع الليد لمرحلته الأصلية', ok: true, ms: 0, note: orig.name })
        }
      } catch (e) { results.push({ step: 'تنظيف: رجوع الليد', ok: false, ms: 0, note: 'فشل — راجع الليد يدويًا: ' + String(e.message).split('\n')[0] }) }
      const failed = results.some(r => !r.ok)
      report('1-desktop', 'كمبيوتر 1440×900 — جلستين super_admin (A و B)', {
        results, consoleErrors, ...log,
        frames: failed ? storeB.frames.filter(f => f.dir === 'in' && (f.event === 'broadcast' || f.event === 'phx_reply' || f.event === 'phx_close' || f.event === 'phx_error')).slice(-14).map(brief) : [],
      })
      await ctxA?.close(); await ctxB?.close()
    }
    test.expect(results.filter(r => !r.ok), 'كل الخطوات لازم تنجح').toEqual([])
  })

  // ----- 3: موبايل (B آيفون، A كمبيوتر على نفس WebKit) -----
  test('mobile B (iPhone WebKit)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone14', 'آيفون بس')
    test.skip(!EMAIL || !PASS, 'مفيش حساب super_admin')
    const results = [], consoleErrors = [], log = { allowed: [], blocked: [] }
    const state = { leadId: null, allowWrites: false }
    const storeA = { frames: [], sockets: [] }, storeB = { frames: [], sockets: [] }
    let ctxA, ctxB, pageA, pageB, orig = null, currentValue = null, leadName = null, boardIdx = 0, T1 = null
    let phase = 'init'
    const step = async (name, fn) => {
      const t0 = Date.now()
      try { const note = await fn(); results.push({ step: name, ok: true, ms: Date.now() - t0, note: note || '' }); return true }
      catch (e) { results.push({ step: name, ok: false, ms: Date.now() - t0, note: String(e.message).split('\n')[0].slice(0, 220) }); return false }
    }
    const chips = (page) => page.evaluate(() => [...document.querySelectorAll('.mstage')].map(b => {
      const n = b.querySelector('.n'); const clone = b.cloneNode(true); clone.querySelector('.n')?.remove()
      return { name: clone.textContent.trim(), n: n ? Number(n.textContent.replace(/,/g, '')) : null, on: b.classList.contains('on') }
    }))
    const clickChip = (page, name) => page.evaluate((nm) => {
      const b = [...document.querySelectorAll('.mstage')].find(x => { const c = x.cloneNode(true); c.querySelector('.n')?.remove(); return c.textContent.trim() === nm })
      if (!b) return false; b.click(); return true
    }, name)
    const rowVisible = (page, nm) => page.evaluate((n) => [...document.querySelectorAll('.mlead-name')].some(e => e.textContent.trim() === n), nm)

    try {
      ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-EG', serviceWorkers: 'block' })
      ctxB = await browser.newContext(testInfo.project.use)
      await guard(ctxA, 'A', state, log); await guard(ctxB, 'B', state, log)
      pageA = await ctxA.newPage(); pageB = await ctxB.newPage()
      wsLog(pageA, storeA); wsLog(pageB, storeB)
      for (const [p, w] of [[pageA, 'A'], [pageB, 'B']]) {
        p.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${w}/${phase}] ${m.text().slice(0, 180)}`) })
        p.on('pageerror', e => consoleErrors.push(`[${w}/${phase}] PAGEERROR ${String(e.message).slice(0, 180)}`))
      }
      pageA.on('response', async (r) => {
        if (state.leadId || !/\/rest\/v1\//.test(r.url())) return
        try { const f = findLead(await r.json()); if (f) { state.leadId = String(f.id); state.leadName = f.full_name } } catch {}
      })

      phase = 'setup'
      const ok1 = await step('A (WebKit كمبيوتر) يلاقي الليد برقم الملف ويفتحه', async () => {
        await login(pageA, log)
        await searchOnBoard(pageA, 0)
        if (!(await pageA.locator('.lead-card').count())) { boardIdx = 1; await searchOnBoard(pageA, 1) }
        if (!state.leadId) throw new Error('ما لقيتش id الليد')
        const info = await openLeadA(pageA)
        orig = { value: info.value, name: stripName(info.options.find(o => o.value === info.value)?.text ?? '?') }
        currentValue = info.value; leadName = info.leadName
        const targets = pickTargets(info.options, info.value)
        if (!targets.length) throw new Error('مفيش مرحلة عادية متاحة')
        T1 = targets[0]
        return `leadId=${state.leadId} المرحلة الحالية "${orig.name}" → الهدف "${stripName(T1.text)}"`
      })
      if (!ok1) throw new Error('setup فشل')

      let before = null
      const ok2 = await step('B (آيفون) يفتح لستة الموبايل على شريحة المرحلة القديمة ويلاقي الليد', async () => {
        await login(pageB, log)
        await pageB.goto('/leads', { waitUntil: 'domcontentloaded' })
        if (boardIdx === 1) await pageB.locator('.board-tabs button').nth(1).click().catch(() => {})
        await pageB.locator('.mstage').first().waitFor({ timeout: 20000 })
        if (!(await clickChip(pageB, orig.name))) throw new Error('مفيش شريحة باسم ' + orig.name)
        await pageB.waitForTimeout(2500)
        // الليد لازم يبان في أول صفحة (نجرّب "عرض المزيد" كام مرة)
        for (let i = 0; i < 4 && !(await rowVisible(pageB, leadName)); i++) {
          const more = pageB.locator('.mlist-more')
          if (!(await more.count())) break
          await more.click(); await pageB.waitForTimeout(1500)
        }
        if (!(await rowVisible(pageB, leadName))) throw new Error(`الليد "${leadName}" مش ظاهر في شريحة "${orig.name}"`)
        before = await chips(pageB)
        await pageB.screenshot({ path: path.join(OUT, 'mobile-B-before.png') }).catch(() => {})
        return `عدد "${orig.name}" = ${before.find(c => c.name === orig.name)?.n}، عدد "${stripName(T1.text)}" = ${before.find(c => c.name === stripName(T1.text))?.n}`
      })
      if (!ok2) throw new Error('B setup فشل')

      phase = 'move1'
      let t1 = null
      await step('د) A ينقل الليد لمرحلة تانية', async () => {
        t1 = await moveTo(pageA, state, T1.value); currentValue = T1.value
        return `إلى "${stripName(T1.text)}"`
      })
      if (!t1) throw new Error('النقل فشل')

      await step('هـ) في B: الليد يختفي من شريحة المرحلة القديمة (< 3 ثواني)', async () => {
        await pageB.waitForFunction((nm) => ![...document.querySelectorAll('.mlead-name')].some(e => e.textContent.trim() === nm), leadName, { timeout: 20000, polling: 50 })
        const ms = Date.now() - t1.tPatch
        await pageB.screenshot({ path: path.join(OUT, 'mobile-B-after-move.png') }).catch(() => {})
        if (ms > SLA_MS) throw new Error(`اختفى بعد ${ms}ms (> ${SLA_MS}ms)`)
        return `اختفى بعد ${ms}ms من رد الحفظ`
      })

      await step('هـ-2) في B: العدد على الشرائح يتحدث (القديمة تقل والجديدة تزيد)', async () => {
        const b0 = before.find(c => c.name === orig.name)?.n, b1 = before.find(c => c.name === stripName(T1.text))?.n
        await pageB.waitForFunction(async ([o, t, bo, bt]) => {
          const get = (nm) => { const b = [...document.querySelectorAll('.mstage')].find(x => { const c = x.cloneNode(true); c.querySelector('.n')?.remove(); return c.textContent.trim() === nm }); const n = b?.querySelector('.n'); return n ? Number(n.textContent.replace(/,/g, '')) : null }
          return get(o) < bo && get(t) > bt
        }, [orig.name, stripName(T1.text), b0, b1], { timeout: 30000, polling: 200 })
        const after = await chips(pageB)
        return `"${orig.name}": ${b0} → ${after.find(c => c.name === orig.name)?.n} | "${stripName(T1.text)}": ${b1} → ${after.find(c => c.name === stripName(T1.text))?.n} (بعد ${Date.now() - t1.tPatch}ms)`
      })

      await step('هـ-3) في B: الليد يظهر في شريحة المرحلة الجديدة', async () => {
        if (!(await clickChip(pageB, stripName(T1.text)))) throw new Error('مفيش شريحة الهدف')
        await pageB.waitForTimeout(2500)
        for (let i = 0; i < 4 && !(await rowVisible(pageB, leadName)); i++) {
          const more = pageB.locator('.mlist-more'); if (!(await more.count())) break
          await more.click(); await pageB.waitForTimeout(1500)
        }
        if (!(await rowVisible(pageB, leadName))) throw new Error('الليد مش ظاهر في الشريحة الجديدة')
        await pageB.screenshot({ path: path.join(OUT, 'mobile-B-new-stage.png') }).catch(() => {})
        return 'ظاهر'
      })

      phase = 'restore'
      await step('رجوع الليد لمرحلته الأصلية (A)', async () => {
        await moveTo(pageA, state, orig.value); currentValue = orig.value
        return orig.name
      })
    } catch (e) {
      results.push({ step: 'خطأ عام', ok: false, ms: 0, note: String(e.message).split('\n')[0].slice(0, 220) })
    } finally {
      try {
        if (orig && currentValue !== orig.value && pageA) {
          if (!(await pageA.locator('#lead-stage-box select').count().catch(() => 0))) { await searchOnBoard(pageA, boardIdx); await openLeadA(pageA) }
          await moveTo(pageA, state, orig.value); currentValue = orig.value
          results.push({ step: 'تنظيف: رجوع الليد لمرحلته الأصلية', ok: true, ms: 0, note: orig.name })
        }
      } catch (e) { results.push({ step: 'تنظيف: رجوع الليد', ok: false, ms: 0, note: 'فشل — راجع الليد يدويًا: ' + String(e.message).split('\n')[0] }) }
      const failed = results.some(r => !r.ok)
      report('2-mobile', 'آيفون WebKit — B موبايل (شرائح المراحل) و A كمبيوتر', {
        results, consoleErrors, ...log,
        frames: failed ? storeB.frames.filter(f => f.dir === 'in' && ['broadcast', 'phx_reply', 'phx_close', 'phx_error'].includes(f.event)).slice(-14).map(brief) : [],
      })
      await ctxA?.close(); await ctxB?.close()
    }
    test.expect(results.filter(r => !r.ok), 'كل الخطوات لازم تنجح').toEqual([])
  })

  // ----- 4: المدفوعات والمعاينات (قراءة فقط) -----
  test('payments + appointments (read-only)', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'كمبيوتر بس')
    test.skip(!EMAIL || !PASS, 'مفيش حساب super_admin')
    const results = [], consoleErrors = [], log = { allowed: [], blocked: [] }
    const state = { leadId: null, allowWrites: false }   // allowWrites دايمًا false هنا
    const store = { frames: [], sockets: [] }
    let phase = 'init'
    const step = async (name, fn) => {
      const t0 = Date.now()
      try { const note = await fn(); results.push({ step: name, ok: true, ms: Date.now() - t0, note: note || '' }) }
      catch (e) { results.push({ step: name, ok: false, ms: Date.now() - t0, note: String(e.message).split('\n')[0].slice(0, 220) }) }
    }
    const ctx = await browser.newContext(testInfo.project.use)
    await guard(ctx, 'C', state, log)
    const page = await ctx.newPage()
    wsLog(page, store)
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${phase}] ${m.text().slice(0, 180)}`) })
    page.on('pageerror', e => consoleErrors.push(`[${phase}] PAGEERROR ${String(e.message).slice(0, 180)}`))
    try {
      await login(page, log)
      for (const [p, label, sel] of [['/payments', 'المدفوعات', 'main'], ['/appointments', 'المعاينات', 'main']]) {
        phase = p
        const errBefore = consoleErrors.length
        await step(`${label} (${p}): تفتح من غير أخطاء console`, async () => {
          await page.goto(p, { waitUntil: 'domcontentloaded' })
          await page.locator(sel).first().waitFor({ timeout: 15000 })
          await page.waitForTimeout(4000)
          const errs = consoleErrors.slice(errBefore)
          if (errs.length) throw new Error(`${errs.length} خطأ console: ${errs[0]}`)
          return 'نضيف'
        })
        await step(`${label} (${p}): الاشتراك broadcast ومفيش postgres_changes على leads/payments/appointments`, async () => {
          const js = joinsOf(store)
          if (!js.some(j => j.topic === 'realtime:crm:role:super_admin' && j.ok) || !js.some(j => j.topic === 'realtime:crm:all' && j.ok)) throw new Error('مفيش انضمام ناجح لقنوات crm:*')
          const bad = pcOnCrmTables(js)
          if (bad.length) throw new Error('postgres_changes: ' + bad.join(', '))
          return `${js.filter(j => j.ok).length}/${js.length} انضمام ناجح`
        })
      }
    } catch (e) {
      results.push({ step: 'خطأ عام', ok: false, ms: 0, note: String(e.message).split('\n')[0].slice(0, 220) })
    } finally {
      const failed = results.some(r => !r.ok)
      report('3-payments-appointments', 'المدفوعات والمعاينات — قراءة فقط', {
        results, consoleErrors, ...log,
        frames: failed ? store.frames.filter(f => ['phx_join', 'phx_reply', 'phx_close', 'phx_error'].includes(f.event)).slice(-14).map(brief) : [],
      })
      await ctx.close()
    }
    test.expect(results.filter(r => !r.ok), 'كل الخطوات لازم تنجح').toEqual([])
  })
})
