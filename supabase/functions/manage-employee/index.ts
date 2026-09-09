// Edge Function: إدارة حسابات الموظفين (إنشاء / تغيير إيميل / تغيير باسورد)
// تعمل على سيرفر Supabase — المفتاح السري محفوظ في أسرار البيئة، لا يصل للواجهة
// يستدعيها المدير العام فقط (يُتحقق من دوره قبل أي إجراء)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPA_URL')!
    const serviceKey = Deno.env.get('SUPA_SERVICE_ROLE')!
    const anonKey = Deno.env.get('SUPA_ANON')!

    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'غير مصرح' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)
    const { data: profile } = await admin
      .from('profiles')
      .select('role_id, roles(code)')
      .eq('id', user.id)
      .single()

    const roleCode = (profile as any)?.roles?.code
    if (roleCode !== 'super_admin') {
      return json({ error: 'هذا الإجراء للمدير العام فقط' }, 403)
    }

    const body = await req.json()
    const { action } = body

    if (action === 'create') {
      const { email, password, full_name, role_id, team_id } = body
      if (!email || !password || !full_name || !role_id) {
        return json({ error: 'بيانات ناقصة' }, 400)
      }
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name },
      })
      if (cErr) return json({ error: cErr.message }, 400)

      await admin.from('profiles').update({
        full_name, role_id,
        team_id: team_id ?? null,
        status: 'active',
        activated_by: user.id,
        activated_at: new Date().toISOString(),
      }).eq('id', created.user.id)

      return json({ ok: true, user_id: created.user.id })
    }

    if (action === 'change_email') {
      const { user_id, new_email } = body
      if (!user_id || !new_email) return json({ error: 'بيانات ناقصة' }, 400)
      const { error: eErr } = await admin.auth.admin.updateUserById(user_id, {
        email: new_email, email_confirm: true,
      })
      if (eErr) return json({ error: eErr.message }, 400)
      await admin.from('profiles').update({ email: new_email }).eq('id', user_id)
      return json({ ok: true })
    }

    if (action === 'change_password') {
      const { user_id, new_password } = body
      if (!user_id || !new_password) return json({ error: 'بيانات ناقصة' }, 400)
      const { error: pErr } = await admin.auth.admin.updateUserById(user_id, {
        password: new_password,
      })
      if (pErr) return json({ error: pErr.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'إجراء غير معروف' }, 400)

  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
