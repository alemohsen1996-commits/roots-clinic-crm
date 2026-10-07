-- ريأكشنز الرسائل (زي واتساب): ريأكشن واحد لكل موظف على كل رسالة
-- أعضاء المحادثة والمراقبين (المديرين) يقدروا يتفاعلوا
create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists chat_reactions_msg_idx on public.chat_reactions(message_id);

alter table public.chat_reactions enable row level security;

-- القراءة: أي حد يقدر يشوف الرسالة (عضو أو مراقب). الكتابة عن طريق chat_react بس
drop policy if exists chat_react_select on public.chat_reactions;
create policy chat_react_select on public.chat_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and public.chat_can_view(m.conversation_id)));

-- تبديل الريأكشن: نفس الإيموجي = شيل، إيموجي تاني = استبدال
create or replace function public.chat_react(p_msg uuid, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_cur text; v_new text; v_payload jsonb;
begin
  select conversation_id into v_conv from public.chat_messages where id = p_msg and deleted_at is null;
  if v_conv is null then raise exception 'الرسالة غير موجودة'; end if;
  if not public.is_active_user() or not public.chat_can_view(v_conv) then raise exception 'غير مصرح'; end if;

  select emoji into v_cur from public.chat_reactions where message_id = p_msg and user_id = auth.uid();
  if p_emoji is null or p_emoji = '' or v_cur = p_emoji then
    delete from public.chat_reactions where message_id = p_msg and user_id = auth.uid();
    v_new := null;
  else
    insert into public.chat_reactions(message_id, user_id, emoji) values (p_msg, auth.uid(), p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
    v_new := p_emoji;
  end if;

  v_payload := jsonb_build_object('conversation_id', v_conv, 'message_id', p_msg, 'user_id', auth.uid(), 'emoji', v_new,
    'full_name', (select full_name from public.profiles where id = auth.uid()));
  perform public.chat_bc_members(v_conv, 'reaction', v_payload);
  perform realtime.send(v_payload, 'reaction', 'chat:monitor', true);
end $$;

revoke all on function public.chat_react(uuid, text) from public, anon;
grant execute on function public.chat_react(uuid, text) to authenticated;
grant select on public.chat_reactions to authenticated;
