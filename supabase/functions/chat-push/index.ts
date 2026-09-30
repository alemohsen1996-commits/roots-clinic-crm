// chat-push — يبعت إشعار Web Push لمستلمي رسالة الشات
// بيتنادى من تريجر chat_msg_push (pg_net) — محمي بمفتاح x-push-key
// المراقبين مش بيوصلهم إشعار: المستلمين = أعضاء المحادثة ما عدا المرسل
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await sb.rpc("chat_push_config");
  if (error || !data) throw new Error("config: " + (error?.message ?? "missing"));
  cfg = data;
  webpush.setVapidDetails("https://crm.rootsklinik.com", data.vapid_public, data.vapid_private);
  return cfg!;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

Deno.serve(async (req) => {
  let c: Record<string, string>;
  try { c = await config(); } catch (e) { return Response.json({ ok: false, error: String(e) }, { status: 500 }); }
  if (req.headers.get("x-push-key") !== c.chat_push_key) return new Response("unauthorized", { status: 401 });

  const { message_id } = await req.json().catch(() => ({}));
  if (!message_id) return Response.json({ ok: false, error: "message_id" }, { status: 400 });

  const { data: m } = await sb.from("chat_messages")
    .select("id, conversation_id, sender_id, body, lead_label, deleted_at, chat_conversations(kind, title), sender:profiles!chat_messages_sender_id_fkey(full_name)")
    .eq("id", message_id).single();
  if (!m || m.deleted_at) return Response.json({ ok: true, skipped: "no message" });

  const { data: parts } = await sb.from("chat_participants")
    .select("user_id").eq("conversation_id", m.conversation_id).is("left_at", null).neq("user_id", m.sender_id);
  const users = (parts ?? []).map((p) => p.user_id);
  if (!users.length) return Response.json({ ok: true, skipped: "no recipients" });

  const [{ data: subs }, { data: unread }] = await Promise.all([
    sb.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, fail_count").in("user_id", users),
    sb.rpc("chat_unread_for", { p_users: users }),
  ]);
  if (!subs?.length) return Response.json({ ok: true, skipped: "no subscriptions" });
  const unreadOf = new Map((unread ?? []).map((u: { user_id: string; unread: number }) => [u.user_id, u.unread]));

  // deno-lint-ignore no-explicit-any
  const conv = (m as any).chat_conversations, sender = (m as any).sender?.full_name ?? "موظف";
  const text = m.body ? clip(m.body, 160) : `📎 ليد: ${m.lead_label ?? ""}`;
  const isGroup = conv?.kind === "group";
  const base = {
    title: isGroup ? (conv.title || "جروب") : sender,
    body: isGroup ? `${sender}: ${text}` : text,
    url: `/chat?c=${m.conversation_id}`,
    tag: `chat-${m.conversation_id}`,
  };

  let sent = 0, removed = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    const payload = JSON.stringify({ ...base, unread: unreadOf.get(s.user_id) ?? 1 });
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload, { TTL: 6 * 3600, urgency: "high" });
      sent++;
      await sb.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      const code = (e as any)?.statusCode;
      if (code === 404 || code === 410 || s.fail_count >= 9) {   // الجهاز ألغى الاشتراك أو انتهى
        await sb.from("push_subscriptions").delete().eq("id", s.id); removed++;
      } else {
        await sb.from("push_subscriptions").update({ fail_count: s.fail_count + 1 }).eq("id", s.id); failed++;
      }
    }
  }));

  return Response.json({ ok: true, sent, removed, failed });
});
