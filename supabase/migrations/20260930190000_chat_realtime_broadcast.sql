-- ============================================================
-- تسريع الشات: Broadcast بدل postgres_changes
-- قبل: كل متصفح عامل 3 اشتراكات على chat_messages، وسيرفر Realtime بيقيّم الـ RLS
--      لكل مشترك مع كل رسالة → تأخير في وصول الرسايل + استدعاءات unread كتير
-- بعد: التريجرات بتبعت الحدث مباشرة لقناة خاصة بكل موظف (chat:u:<id>)
--      + قناة chat:monitor للمديرين (معرّفات بس — التفاصيل بتتجاب عبر RLS)
-- ============================================================

create or replace function public.chat_bc_members(p_conv uuid, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select user_id from public.chat_participants where conversation_id = p_conv and left_at is null loop
    perform realtime.send(p_payload, p_event, 'chat:u:' || u, true);
  end loop;
end $$;
revoke all on function public.chat_bc_members(uuid, text, jsonb) from public, anon, authenticated;

-- الرسائل: جديدة / معدّلة / محذوفة
create or replace function public.chat_msg_broadcast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.chat_bc_members(new.conversation_id,
    case when tg_op = 'INSERT' then 'msg_new' else 'msg_update' end, to_jsonb(new));
  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'op', lower(tg_op)),
    'activity', 'chat:monitor', true);
  return null;
exception when others then
  raise warning 'chat broadcast failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.chat_msg_broadcast() from public, anon, authenticated;

create trigger chat_msg_broadcast after insert or update on public.chat_messages
  for each row execute function public.chat_msg_broadcast();

-- الأعضاء: القراءة (علامات ✓✓) + الإضافة/الخروج
create or replace function public.chat_part_broadcast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.left_at is not distinct from old.left_at and new.is_admin = old.is_admin then
    if new.last_read_at is distinct from old.last_read_at then
      perform public.chat_bc_members(new.conversation_id, 'read', jsonb_build_object(
        'conversation_id', new.conversation_id, 'user_id', new.user_id, 'last_read_at', new.last_read_at));
    end if;
  else
    perform public.chat_bc_members(new.conversation_id, 'members',
      jsonb_build_object('conversation_id', new.conversation_id));
    if new.left_at is not null then   -- اللي خرج/اتشال يعرف كمان
      perform realtime.send(jsonb_build_object('conversation_id', new.conversation_id),
        'members', 'chat:u:' || new.user_id, true);
    end if;
  end if;
  return null;
exception when others then
  raise warning 'chat broadcast failed: %', sqlerrm;
  return null;
end $$;
revoke all on function public.chat_part_broadcast() from public, anon, authenticated;

create trigger chat_part_broadcast after insert or update on public.chat_participants
  for each row execute function public.chat_part_broadcast();

-- تغيير اسم الجروب
create or replace function public.chat_conv_broadcast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title then
    perform public.chat_bc_members(new.id, 'members', jsonb_build_object('conversation_id', new.id));
  end if;
  return null;
exception when others then
  return null;
end $$;
revoke all on function public.chat_conv_broadcast() from public, anon, authenticated;

create trigger chat_conv_broadcast after update of title on public.chat_conversations
  for each row execute function public.chat_conv_broadcast();

-- مين يستقبل إيه: كل موظف قناته بس، والمديرين قناة المراقبة
create policy chat_rt_receive on realtime.messages
  for select to authenticated using (
    realtime.topic() = 'chat:u:' || (select auth.uid())::text
    or (realtime.topic() = 'chat:monitor'
        and (select public.current_role_code()) in ('super_admin', 'sales_manager'))
  );

-- ملحوظة: جداول الشات لسه في supabase_realtime عشان النسخة القديمة من الواجهة تفضل شغالة
-- لحد الـ deploy — بعده مفيش مشتركين عليها، وممكن تتشال في migration لاحقة
