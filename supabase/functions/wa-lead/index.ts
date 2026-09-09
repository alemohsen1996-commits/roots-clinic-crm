// Edge Function: استقبال ليد جديد من برنامج واتساب
// يستدعيها برنامجك (WA Tracker) بدل Zoho
// - يبحث بالرقم: لو موجود يرجّع بياناته، لو جديد ينشئ ليد ويسنده للموظف
// - الحماية: مفتاح سري في الهيدر (x-api-key)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// تطبيع الرقم: أرقام فقط مع + في البداية
function normalizePhone(raw: string) {
  const digits = String(raw).replace(/[^\d]/g, '')
  return digits ? '+' + digits : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // 1) التحقق من المفتاح السري
    const apiKey = req.headers.get('x-api-key') ?? ''
    const expected = Deno.env.get('WA_API_KEY') ?? ''
    if (!expected || apiKey !== expected) {
      return json({ error: 'unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPA_URL')!
    const serviceKey = Deno.env.get('SUPA_SERVICE_ROLE')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 2) قراءة البيانات المرسلة
    const body = await req.json()
    const phoneRaw = body.phone ?? ''
    const agentEmail = body.agent_email ?? null   // إيميل الموظف صاحب الجلسة
    const name = body.name ?? null                 // اسم إن توفّر
    const direction = body.direction ?? 'incoming' // incoming | outgoing

    const phone = normalizePhone(phoneRaw)
    if (!phone || phone.length < 8) return json({ error: 'رقم غير صالح' }, 400)

    // 3) هل الرقم موجود بالفعل؟
    const { data: existing } = await admin
      .from('leads')
      .select('id, file_no, full_name, stage_id, owner_id, stages(name_ar), owner:profiles!leads_owner_id_fkey(full_name)')
      .eq('phone', phone)
      .maybeSingle()

    if (existing) {
      return json({
        status: 'found',
        lead_id: existing.id,
        file_no: existing.file_no,
        name: existing.full_name,
        stage: (existing as any).stages?.name_ar ?? null,
        owner: (existing as any).owner?.full_name ?? null,
      })
    }

    // 4) جديد → نحدد الموظف
    let ownerId: string | null = null
    if (agentEmail) {
      const { data: agent } = await admin
        .from('profiles')
        .select('id')
        .eq('email', agentEmail)
        .eq('status', 'active')
        .maybeSingle()
      ownerId = agent?.id ?? null
    }

    // 5) المرحلة الأولى ومصدر واتساب
    const { data: newStage } = await admin
      .from('stages').select('id').eq('code', 'new').single()

    let sourceId: number | null = null
    const { data: waSource } = await admin
      .from('lead_sources').select('id').eq('code', 'whatsapp').maybeSingle()
    if (waSource) sourceId = waSource.id

    // 6) إنشاء الليد
    const { data: created, error: cErr } = await admin
      .from('leads')
      .insert({
        full_name: name || `عميل واتساب ${phone.slice(-4)}`,
        phone,
        stage_id: newStage?.id,
        owner_id: ownerId,
        source_id: sourceId,
        notes: `وارد من واتساب (${direction === 'outgoing' ? 'صادر' : 'وارد'})`,
      })
      .select('id, file_no')
      .single()

    if (cErr) return json({ error: cErr.message }, 400)

    // 7) تسجيل نشاط
    await admin.from('activities').insert({
      lead_id: created.id,
      user_id: ownerId,
      type: 'whatsapp',
      content: `أُنشئ تلقائيًا من واتساب — ${direction === 'outgoing' ? 'رسالة صادرة' : 'رسالة واردة'}`,
    })

    return json({
      status: 'created',
      lead_id: created.id,
      file_no: created.file_no,
      owner_assigned: !!ownerId,
    })

  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
