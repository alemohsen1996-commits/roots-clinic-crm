-- معاينة آخر رسالة في القائمة لازم تتحدث بعد التعديل/الحذف — وإلا النص المحذوف يفضل ظاهر
create or replace function public.chat_refresh_preview(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update public.chat_conversations c set
    last_message_preview = coalesce(
      (select case when m.deleted_at is not null then '🚫 تم حذف الرسالة'
                   else coalesce(left(m.body, 140), '📎 ليد: ' || m.lead_label) end
         from public.chat_messages m where m.conversation_id = p_conv
        order by m.created_at desc limit 1), c.last_message_preview)
  where c.id = p_conv;
$$;
revoke all on function public.chat_refresh_preview(uuid) from public, anon, authenticated;

create or replace function public.chat_edit_message(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id for update;
  if m.id is null or m.sender_id <> auth.uid() or m.deleted_at is not null then
    raise exception 'غير مصرح';
  end if;
  if m.created_at < now() - interval '24 hours' then
    raise exception 'التعديل متاح خلال 24 ساعة من الإرسال فقط';
  end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'الرسالة فاضية'; end if;
  if btrim(p_body) = m.body then return; end if;
  insert into public.chat_message_history (message_id, action, old_body, actor_id)
  values (m.id, 'edit', m.body, auth.uid());
  update public.chat_messages set body = btrim(p_body), edited_at = now() where id = p_id;
  perform public.chat_refresh_preview(m.conversation_id);
end $$;

create or replace function public.chat_delete_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.chat_messages;
begin
  select * into m from public.chat_messages where id = p_id for update;
  if m.id is null or m.sender_id <> auth.uid() or m.deleted_at is not null then
    raise exception 'غير مصرح';
  end if;
  insert into public.chat_message_history (message_id, action, old_body, actor_id)
  values (m.id, 'delete',
          concat_ws(E'\n', m.body, case when m.lead_label is not null then '📎 ليد: ' || m.lead_label end),
          auth.uid());
  update public.chat_messages
     set body = null, lead_id = null, lead_label = null, deleted_at = now()
   where id = p_id;
  perform public.chat_refresh_preview(m.conversation_id);
end $$;
