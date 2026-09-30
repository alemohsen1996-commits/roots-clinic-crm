-- ============================================================
-- الشات الداخلي بين الموظفين — المرحلة 1
-- • محادثات فردية (أي موظف مع أي موظف) + جروبات (ينشئها المدير)
-- • ربط رسالة أو جروب بليد
-- • رقابة: المدير العام يرى كل المحادثات، ومدير المبيعات يرى كل
--   المحادثات ما عدا اللي فيها المدير العام — قراءة فقط
-- • لا مسح حقيقي: التعديل والحذف يحفظان النص الأصلي في سجل للإدارة
-- • سجل بمن فتح محادثة ليس طرفًا فيها (للمدير العام)
-- ============================================================

-- ---------- الجداول ----------
create table public.chat_conversations (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('direct','group')),
  title                text,
  direct_key           text unique,             -- للمحادثة الفردية: الطرفين مرتّبين — تمنع التكرار
  lead_id              bigint references public.leads(id) on delete set null,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  last_message_at      timestamptz,
  last_message_preview text,
  last_sender_id       uuid references public.profiles(id),
  check (kind = 'group' or direct_key is not null)
);
create index chat_conv_last_idx on public.chat_conversations (last_message_at desc nulls last);

create table public.chat_participants (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  is_admin        boolean not null default false,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index chat_part_user_idx on public.chat_participants (user_id) where left_at is null;

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id),
  body            text check (body is null or char_length(body) between 1 and 4000),
  lead_id         bigint references public.leads(id) on delete set null,
  lead_label      text,
  reply_to        uuid references public.chat_messages(id) on delete set null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
create index chat_msg_conv_idx on public.chat_messages (conversation_id, created_at desc);
create index chat_msg_sender_idx on public.chat_messages (sender_id);
create index chat_msg_lead_idx on public.chat_messages (lead_id) where lead_id is not null;

-- النص الأصلي قبل أي تعديل أو حذف — يراه المديرون فقط
create table public.chat_message_history (
  id         bigint generated always as identity primary key,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  action     text not null check (action in ('edit','delete')),
  old_body   text,
  actor_id   uuid references public.profiles(id),
  at         timestamptz not null default now()
);
create index chat_hist_msg_idx on public.chat_message_history (message_id);

-- من فتح محادثة وهو مش طرف فيها
create table public.chat_monitor_log (
  id              bigint generated always as identity primary key,
  viewer_id       uuid not null references public.profiles(id),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  viewed_at       timestamptz not null default now()
);
create index chat_monlog_idx on public.chat_monitor_log (conversation_id, viewed_at desc);

-- ---------- دوال الصلاحيات ----------
create or replace function public.chat_is_participant(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_participants
    where conversation_id = p_conv and user_id = auth.uid() and left_at is null
  ) and public.is_active_user();
$$;

-- المراقبة: المدير العام الكل، مدير المبيعات الكل ما عدا محادثات فيها المدير العام
create or replace function public.chat_can_monitor(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_role_code()
    when 'super_admin' then true
    when 'sales_manager' then not exists (
      select 1 from public.chat_participants cp
      join public.profiles p on p.id = cp.user_id
      join public.roles r on r.id = p.role_id
      where cp.conversation_id = p_conv and r.code = 'super_admin')
    else false end
    and public.is_active_user();
$$;

create or replace function public.chat_can_view(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.chat_is_participant(p_conv) or public.chat_can_monitor(p_conv);
$$;

-- ---------- RLS ----------
alter table public.chat_conversations   enable row level security;
alter table public.chat_participants    enable row level security;
alter table public.chat_messages        enable row level security;
alter table public.chat_message_history enable row level security;
alter table public.chat_monitor_log     enable row level security;

create policy chat_conv_select on public.chat_conversations
  for select to authenticated using (public.chat_can_view(id));

create policy chat_part_select on public.chat_participants
  for select to authenticated using (public.chat_can_view(conversation_id));

create policy chat_msg_select on public.chat_messages
  for select to authenticated using (public.chat_can_view(conversation_id));

-- الإرسال: الطرف في المحادثة فقط (المراقب قراءة فقط)
create policy chat_msg_insert on public.chat_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.chat_is_participant(conversation_id)
    and edited_at is null and deleted_at is null
  );

create policy chat_hist_select on public.chat_message_history
  for select to authenticated using (
    exists (select 1 from public.chat_messages m
            where m.id = message_id and public.chat_can_monitor(m.conversation_id))
  );

create policy chat_monlog_select on public.chat_monitor_log
  for select to authenticated using ((select public.current_role_code()) = 'super_admin');

-- لا insert/update/delete مباشر على بقية الجداول — كله عبر الدوال بالأسفل

-- ---------- تريجرات الرسائل ----------
-- invoker عمدًا: الليد المرفق لازم يكون ظاهر للمرسل حسب صلاحياته
create or replace function public.chat_msg_before_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  new.body := nullif(btrim(new.body), '');
  new.created_at := now();
  if new.body is null and new.lead_id is null then
    raise exception 'الرسالة فاضية';
  end if;
  if new.lead_id is not null then
    select concat_ws(' · ', nullif(l.file_no, ''), l.full_name)
      into new.lead_label from public.leads l where l.id = new.lead_id;
    if new.lead_label is null then raise exception 'الليد غير متاح'; end if;
  else
    new.lead_label := null;
  end if;
  if new.reply_to is not null and not exists (
    select 1 from public.chat_messages where id = new.reply_to and conversation_id = new.conversation_id
  ) then
    new.reply_to := null;
  end if;
  return new;
end $$;

create trigger chat_msg_before_insert before insert on public.chat_messages
  for each row execute function public.chat_msg_before_insert();

create or replace function public.chat_msg_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.chat_conversations set
    last_message_at = new.created_at,
    last_message_preview = coalesce(left(new.body, 140), '📎 ليد: ' || new.lead_label),
    last_sender_id = new.sender_id
  where id = new.conversation_id;
  update public.chat_participants set last_read_at = new.created_at
  where conversation_id = new.conversation_id and user_id = new.sender_id;
  return null;
end $$;

create trigger chat_msg_after_insert after insert on public.chat_messages
  for each row execute function public.chat_msg_after_insert();

-- ---------- دوال التشغيل ----------

-- فتح (أو إرجاع) محادثة فردية مع موظف
create or replace function public.chat_start_direct(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_key text; v_id uuid;
begin
  if not public.is_active_user() then raise exception 'غير مصرح'; end if;
  if p_user is null or p_user = v_me then raise exception 'اختار موظف تاني'; end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then
    raise exception 'الموظف غير موجود أو غير مفعّل';
  end if;
  v_key := least(v_me::text, p_user::text) || ':' || greatest(v_me::text, p_user::text);

  select id into v_id from public.chat_conversations where direct_key = v_key;
  if v_id is null then
    insert into public.chat_conversations (kind, direct_key, created_by)
    values ('direct', v_key, v_me)
    on conflict (direct_key) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.chat_conversations where direct_key = v_key;
    end if;
  end if;

  insert into public.chat_participants (conversation_id, user_id)
  values (v_id, v_me), (v_id, p_user)
  on conflict (conversation_id, user_id) do update set left_at = null;
  return v_id;
end $$;

-- إنشاء جروب — للمديرين
create or replace function public.chat_create_group(p_title text, p_members uuid[], p_lead_id bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_id uuid;
begin
  if not public.is_manager() or not public.is_active_user() then
    raise exception 'إنشاء الجروبات للمديرين فقط';
  end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'اكتب اسم الجروب'; end if;

  insert into public.chat_conversations (kind, title, lead_id, created_by)
  values ('group', btrim(p_title), p_lead_id, v_me) returning id into v_id;

  insert into public.chat_participants (conversation_id, user_id, is_admin)
  values (v_id, v_me, true);

  insert into public.chat_participants (conversation_id, user_id)
  select v_id, p.id from public.profiles p
  where p.id = any(coalesce(p_members, '{}')) and p.id <> v_me and p.status = 'active'
  on conflict do nothing;
  return v_id;
end $$;

create or replace function public.chat_is_group_admin(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_conversations c where c.id = p_conv and c.kind = 'group')
    and (public.is_manager() or exists (
      select 1 from public.chat_participants
      where conversation_id = p_conv and user_id = auth.uid() and is_admin and left_at is null));
$$;

create or replace function public.chat_add_members(p_conv uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_group_admin(p_conv) then raise exception 'غير مصرح'; end if;
  insert into public.chat_participants (conversation_id, user_id)
  select p_conv, p.id from public.profiles p
  where p.id = any(coalesce(p_members, '{}')) and p.status = 'active'
  on conflict (conversation_id, user_id) do update set left_at = null, joined_at = now();
end $$;

create or replace function public.chat_remove_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- الموظف يقدر يخرج بنفسه، والإزالة لأدمن الجروب أو المدير
  if p_user <> auth.uid() and not public.chat_is_group_admin(p_conv) then
    raise exception 'غير مصرح';
  end if;
  if not exists (select 1 from public.chat_conversations where id = p_conv and kind = 'group') then
    raise exception 'المحادثة الفردية لا يمكن الخروج منها';
  end if;
  update public.chat_participants set left_at = now()
  where conversation_id = p_conv and user_id = p_user and left_at is null;
end $$;

create or replace function public.chat_rename_group(p_conv uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.chat_is_group_admin(p_conv) then raise exception 'غير مصرح'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'اكتب اسم الجروب'; end if;
  update public.chat_conversations set title = btrim(p_title) where id = p_conv;
end $$;

-- تعديل رسالة: صاحبها فقط وخلال 24 ساعة — النص القديم يتحفظ
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
end $$;

-- حذف رسالة: صاحبها فقط — بتختفي عند الموظفين وتفضل محفوظة للإدارة
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
end $$;

create or replace function public.chat_mark_read(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update public.chat_participants set last_read_at = now()
  where conversation_id = p_conv and user_id = auth.uid() and left_at is null;
$$;

-- صندوق محادثاتي مع عدد غير المقروء
create or replace function public.chat_inbox()
returns table (
  conversation_id uuid, kind text, title text, lead_id bigint,
  last_message_at timestamptz, last_message_preview text, last_sender_id uuid,
  unread int, members jsonb
) language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.title, c.lead_id,
         c.last_message_at, c.last_message_preview, c.last_sender_id,
         (select count(*)::int from public.chat_messages m
           where m.conversation_id = c.id and m.created_at > me.last_read_at
             and m.sender_id <> auth.uid() and m.deleted_at is null),
         (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'full_name', p.full_name, 'role', r.name_ar,
                  'last_read_at', cp.last_read_at) order by p.full_name), '[]'::jsonb)
            from public.chat_participants cp
            join public.profiles p on p.id = cp.user_id
            left join public.roles r on r.id = p.role_id
           where cp.conversation_id = c.id and cp.left_at is null)
  from public.chat_participants me
  join public.chat_conversations c on c.id = me.conversation_id
  where me.user_id = auth.uid() and me.left_at is null and public.is_active_user()
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

create or replace function public.chat_unread_total()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.chat_participants me
  join public.chat_messages m on m.conversation_id = me.conversation_id
  where me.user_id = auth.uid() and me.left_at is null
    and m.created_at > me.last_read_at and m.sender_id <> auth.uid() and m.deleted_at is null;
$$;

-- قائمة المراقبة: محادثات الموظفين اللي المدير مش طرف فيها
-- p_user: فلتر على موظف معيّن — p_search: اسم موظف أو كلمة داخل الرسائل (حتى المحذوفة/المعدّلة)
create or replace function public.chat_monitor_list(p_user uuid default null, p_search text default null, p_limit int default 200)
returns table (
  conversation_id uuid, kind text, title text, lead_id bigint,
  last_message_at timestamptz, last_message_preview text, last_sender_id uuid,
  message_count int, edited_or_deleted int, members jsonb
) language plpgsql stable security definer set search_path = public as $$
declare v_q text := nullif(btrim(p_search), '');
begin
  if public.current_role_code() not in ('super_admin','sales_manager') or not public.is_active_user() then
    raise exception 'غير مصرح';
  end if;
  return query
  select c.id, c.kind, c.title, c.lead_id,
         c.last_message_at, c.last_message_preview, c.last_sender_id,
         (select count(*)::int from public.chat_messages m where m.conversation_id = c.id),
         (select count(*)::int from public.chat_messages m
           where m.conversation_id = c.id and (m.edited_at is not null or m.deleted_at is not null)),
         (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'full_name', p.full_name, 'role', r.name_ar) order by p.full_name), '[]'::jsonb)
            from public.chat_participants cp
            join public.profiles p on p.id = cp.user_id
            left join public.roles r on r.id = p.role_id
           where cp.conversation_id = c.id and cp.left_at is null)
  from public.chat_conversations c
  where c.last_message_at is not null
    and public.chat_can_monitor(c.id)
    and (p_user is null or exists (select 1 from public.chat_participants x
                                   where x.conversation_id = c.id and x.user_id = p_user))
    and (v_q is null
         or c.title ilike '%' || v_q || '%'
         or exists (select 1 from public.chat_participants x join public.profiles p on p.id = x.user_id
                    where x.conversation_id = c.id and p.full_name ilike '%' || v_q || '%')
         or exists (select 1 from public.chat_messages m
                    where m.conversation_id = c.id and m.body ilike '%' || v_q || '%')
         or exists (select 1 from public.chat_messages m join public.chat_message_history h on h.message_id = m.id
                    where m.conversation_id = c.id and h.old_body ilike '%' || v_q || '%'))
  order by c.last_message_at desc
  limit greatest(1, least(p_limit, 500));
end $$;

-- تسجيل فتح محادثة من المراقبة (مرة كل 10 دقائق لنفس المحادثة)
create or replace function public.chat_log_view(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.chat_is_participant(p_conv) or not public.chat_can_monitor(p_conv) then return; end if;
  if exists (select 1 from public.chat_monitor_log
             where conversation_id = p_conv and viewer_id = auth.uid()
               and viewed_at > now() - interval '10 minutes') then return; end if;
  insert into public.chat_monitor_log (viewer_id, conversation_id) values (auth.uid(), p_conv);
end $$;

-- ---------- الصلاحيات على الدوال ----------
do $$
declare f text;
begin
  foreach f in array array[
    'chat_is_participant(uuid)','chat_can_monitor(uuid)','chat_can_view(uuid)','chat_is_group_admin(uuid)',
    'chat_start_direct(uuid)','chat_create_group(text,uuid[],bigint)','chat_add_members(uuid,uuid[])',
    'chat_remove_member(uuid,uuid)','chat_rename_group(uuid,text)','chat_edit_message(uuid,text)',
    'chat_delete_message(uuid)','chat_mark_read(uuid)','chat_inbox()','chat_unread_total()',
    'chat_monitor_list(uuid,text,int)','chat_log_view(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.chat_msg_before_insert() from public, anon, authenticated';
  execute 'revoke all on function public.chat_msg_after_insert() from public, anon, authenticated';
end $$;

revoke all on public.chat_conversations, public.chat_participants, public.chat_messages,
              public.chat_message_history, public.chat_monitor_log from anon;

-- ---------- Realtime ----------
do $$
declare t text;
begin
  foreach t in array array['chat_messages','chat_participants','chat_conversations'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
