-- ========== المعاينات — المرحلة 1: الأساس ==========

-- 1) إعداد ساعات عمل كل فرع (صف واحد لكل فرع)
create table if not exists public.branch_schedules (
  id           bigint generated always as identity primary key,
  branch_id    bigint not null unique references public.branches(id) on delete cascade,
  work_days    int[]  not null default '{}',   -- أرقام الأيام 0=الأحد .. 6=السبت
  start_time   time   not null,
  end_time     time   not null,
  slot_minutes int    not null default 30 check (slot_minutes between 5 and 240),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id),
  check (end_time > start_time)
);

-- 2) المعاينات — كل معاينة مربوطة بليد
create table if not exists public.appointments (
  id               bigint generated always as identity primary key,
  lead_id          bigint not null references public.leads(id) on delete cascade,
  branch_id        bigint not null references public.branches(id),
  coordinator_id   uuid references public.profiles(id),
  appt_date        date,
  appt_time        time,
  status           text not null default 'pending'
                   check (status in ('pending','booked','attended','no_show','rescheduled')),
  callcenter_note  text,   -- ملاحظات الكول سنتر (من السيلز)
  coordinator_note text,   -- فيدباك المنسقة
  rescheduled_to   bigint references public.appointments(id),
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status not in ('booked','attended') or (appt_date is not null and appt_time is not null))
);

-- قفل الخانة: خانة (فرع+يوم+وقت) واحدة لمريض واحد في الحالات النشطة فقط.
create unique index if not exists uq_appt_slot
  on public.appointments (branch_id, appt_date, appt_time)
  where status in ('booked','attended') and appt_date is not null and appt_time is not null;

create index if not exists idx_appt_branch_date on public.appointments (branch_id, appt_date);
create index if not exists idx_appt_lead        on public.appointments (lead_id);

-- 3) RLS
alter table public.branch_schedules enable row level security;
alter table public.appointments     enable row level security;

create policy "قراءة إعدادات الفروع" on public.branch_schedules
  for select using ((select is_active_user()));
create policy "تعديل إعدادات الفروع: المدير" on public.branch_schedules
  for all using ((select is_manager())) with check ((select is_manager()));

create policy "قراءة المعاينات" on public.appointments
  for select using (
    (select is_manager())
    or (select current_role_code()) = 'coordinator'
    or coordinator_id = (select auth.uid())
    or created_by     = (select auth.uid())
    or i_own_lead(lead_id)
  );
create policy "إنشاء معاينة" on public.appointments
  for insert with check (
    (select is_manager())
    or (select current_role_code()) = 'coordinator'
    or i_own_lead(lead_id)
  );
create policy "تعديل المعاينة" on public.appointments
  for update using (
    (select is_manager())
    or (select current_role_code()) = 'coordinator'
    or created_by = (select auth.uid())
    or i_own_lead(lead_id)
  );
create policy "حذف المعاينة" on public.appointments
  for delete using (
    (select is_manager())
    or (select current_role_code()) = 'coordinator'
    or created_by = (select auth.uid())
  );

-- 4) صلاحيات الجداول
grant select, insert, update, delete on public.branch_schedules to authenticated;
grant select, insert, update, delete on public.appointments     to authenticated;
