-- ============================================================
-- إشعارات الشات على الموبايل والكمبيوتر (Web Push)
-- • push_subscriptions: اشتراك كل جهاز لكل موظف
-- • تريجر على chat_messages يكلّم Edge Function «chat-push» عن طريق pg_net
-- • المفاتيح في Vault: chat_push_key / vapid_public / vapid_private
--   (اتضافت مباشرة، مش جوه الـ migration عشان ما تتحفظش في الريبو)
-- ============================================================

create table public.push_subscriptions (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  fail_count      int not null default 0
);
create index push_subs_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subs_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_subscriptions from anon;

-- الجهاز ممكن يتنقل لموظف تاني (تسجيل خروج ودخول) → الاشتراك بيتنقل معاه
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'غير مصرح'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' then raise exception 'اشتراك غير صالح'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, fail_count = 0;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- للـ Edge Function فقط (service_role)
create or replace function public.chat_push_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(name, decrypted_secret)
  from vault.decrypted_secrets where name in ('chat_push_key','vapid_public','vapid_private');
$$;

-- عدد غير المقروء لكل مستلم — للرقم اللي على أيقونة الأبلكيشن
create or replace function public.chat_unread_for(p_users uuid[])
returns table (user_id uuid, unread int) language sql stable security definer set search_path = public as $$
  select me.user_id, count(m.id)::int
  from public.chat_participants me
  left join public.chat_messages m on m.conversation_id = me.conversation_id
       and m.created_at > me.last_read_at and m.sender_id <> me.user_id and m.deleted_at is null
  where me.user_id = any(p_users) and me.left_at is null
  group by me.user_id;
$$;

revoke all on function public.push_subscribe(text,text,text,text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text,text,text,text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
revoke all on function public.chat_push_config() from public, anon, authenticated;
revoke all on function public.chat_unread_for(uuid[]) from public, anon, authenticated;
grant execute on function public.chat_push_config() to service_role;
grant execute on function public.chat_unread_for(uuid[]) to service_role;

-- التريجر: يبعت بس لو فيه مستلم عنده جهاز مشترك — وأي فشل ما يوقفش الرسالة
create or replace function public.chat_msg_push()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.chat_participants cp
    join public.push_subscriptions s on s.user_id = cp.user_id
    where cp.conversation_id = new.conversation_id and cp.left_at is null and cp.user_id <> new.sender_id
  ) then
    perform net.http_post(
      url := 'https://svuoddaundjfnssvqnpv.supabase.co/functions/v1/chat-push',
      body := jsonb_build_object('message_id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-key', (select decrypted_secret from vault.decrypted_secrets where name = 'chat_push_key')),
      timeout_milliseconds := 15000);
  end if;
  return null;
exception when others then
  raise warning 'chat push failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.chat_msg_push() from public, anon, authenticated;

create trigger chat_msg_push after insert on public.chat_messages
  for each row execute function public.chat_msg_push();
