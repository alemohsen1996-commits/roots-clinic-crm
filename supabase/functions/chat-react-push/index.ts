// chat-react-push — إشعار Web Push لصاحب الرسالة لما حد يتفاعل عليها (زي واتساب)
// بيتنادى من الواجهة بعد chat_react بتوكن الموظف (verify_jwt) — ومش بنصدّق أي حاجة من الطلب غير message_id:
// بنتأكد من الداتابيز إن الموظف ده فعلاً حاطط ريأكشن على الرسالة دي
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: cors });

let ready = false;
async function vapid() {
  if (ready) return;
  const { data, error } = await sb.rpc("chat_push_config");
  if (error || !data) throw new Error("config: " + (error?.message ?? "missing"));
  webpush.setVapidDetails("https://crm.rootsklinik.com", data.vapid_public, data.vapid_private);
  ready = true;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // مين اللي عمل الريأكشن — من التوكن مش من الطلب
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await sb.auth.getUser(token);
  const reactor = auth?.user?.id;
  if (!reactor) return json({ ok: false, error: "unauthorized" }, 401);

  const { message_id } = await req.json().catch(() => ({}));
  if (!message_id) return json({ ok: false, error: "message_id" }, 400);

  const [{ data: r }, { data: m, error: mErr }] = await Promise.all([
    sb.from("chat_reactions").select("emoji, profiles(full_name)").eq("message_id", message_id).eq("user_id", reactor).maybeSingle(),
    sb.from("chat_messages")
      .select("id, conversation_id, sender_id, body, attachment_type, attachment_name, lead_label, deleted_at, chat_conversations!chat_messages_conversation_id_fkey(kind, title)")
      .eq("id", message_id).maybeSingle(),
  ]);
  if (mErr) { console.error("[chat-react-push]", mErr); return json({ ok: false, error: mErr.message }, 500); }
  if (!r) return json({ ok: true, skipped: "no reaction" });            // اتشال قبل ما نوصل
  if (!m || m.deleted_at) return json({ ok: true, skipped: "no message" });
  if (m.sender_id === reactor) return json({ ok: true, skipped: "own message" });

  // صاحب الرسالة لسه في المحادثة؟
  const { data: still } = await sb.from("chat_participants").select("user_id")
    .eq("conversation_id", m.conversation_id).eq("user_id", m.sender_id).is("left_at", null).maybeSingle();
  if (!still) return json({ ok: true, skipped: "sender left" });

  const { data: subs } = await sb.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, fail_count").eq("user_id", m.sender_id);
  if (!subs?.length) return json({ ok: true, skipped: "no subscriptions" });

  try { await vapid(); } catch (e) { return json({ ok: false, error: String(e) }, 500); }

  // deno-lint-ignore no-explicit-any
  const conv = (m as any).chat_conversations, who = (r as any).profiles?.full_name ?? "موظف";
  const what = m.body ? `«${clip(m.body, 80)}»`
    : m.attachment_type === "image" ? "📷 صورة"
    : m.attachment_type === "file" ? `📄 ${m.attachment_name ?? "ملف"}`
    : `📎 ${m.lead_label ?? "ليد"}`;
  const payload = JSON.stringify({
    title: `${who} ${r.emoji}`,
    body: (conv?.kind === "group" && conv.title ? `${conv.title} · ` : "") + `تفاعل على رسالتك: ${what}`,
    url: `/chat?c=${m.conversation_id}`,
    tag: `react-${m.id}`,          // تغيير الريأكشن بيستبدل الإشعار القديم بدل ما يتراكم
    kind: "reaction",
  });

  let sent = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 3600, urgency: "normal" });
      sent++;
      await sb.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const code = (e as any)?.statusCode;
      if (code === 404 || code === 410 || s.fail_count >= 9) {
        await sb.from("push_subscriptions").delete().eq("id", s.id); removed++;
      } else {
        await sb.from("push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("id", s.id);
      }
    }
  }));
  return json({ ok: true, sent, removed });
});
