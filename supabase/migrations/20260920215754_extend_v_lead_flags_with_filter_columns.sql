-- يوسّع v_lead_flags بأعمدة الفلترة من leads حتى يمكن تطبيق كل الفلاتر
-- (مصدر/فرع/اهتمام/بحث/تاريخ/سعر/عمر/إيقاف/تأجيل) مباشرةً على الـ view.
-- الأعمدة العشرة الأولى محفوظة بنفس الترتيب والتعبيرات (CREATE OR REPLACE يتطلب ذلك)،
-- والجديد مُضاف في النهاية فقط. security_invoker=off محفوظ كما كان.
CREATE OR REPLACE VIEW public.v_lead_flags
WITH (security_invoker=off) AS
SELECT
    l.id AS lead_id,
    l.stage_id,
    l.archived_at,
    l.owner_id,
    l.coordinator_id,
    ( SELECT min(t.due_at) AS min
        FROM tasks t
       WHERE t.lead_id = l.id AND t.status = 'open'::text) AS next_due,
    ( SELECT count(*) AS count
        FROM tasks t
       WHERE t.lead_id = l.id AND t.status = 'open'::text) AS open_tasks,
    (EXISTS ( SELECT 1
        FROM tasks t
       WHERE t.lead_id = l.id AND t.status = 'open'::text
         AND t.due_at >= date_trunc('day'::text, now())
         AND t.due_at < (date_trunc('day'::text, now()) + '1 day'::interval))) AS task_today,
    (EXISTS ( SELECT 1
        FROM tasks t
       WHERE t.lead_id = l.id AND t.status = 'open'::text
         AND t.due_at < now())) AS task_overdue,
    CASE
        WHEN l.follow_paused THEN 0
        WHEN s.code = ANY (ARRAY['dead'::text, 'lost'::text, 'done'::text, 'won'::text]) THEN 0
        WHEN l.snooze_until IS NOT NULL AND l.snooze_until > now() THEN 0
        WHEN (EXISTS ( SELECT 1
           FROM tasks t
          WHERE t.lead_id = l.id AND t.status = 'open'::text AND t.due_at <= now()))
          THEN GREATEST(1, EXTRACT(day FROM now() - (( SELECT min(t.due_at) AS min
               FROM tasks t
              WHERE t.lead_id = l.id AND t.status = 'open'::text)))::integer)
        WHEN (EXISTS ( SELECT 1
           FROM tasks t
          WHERE t.lead_id = l.id AND t.status = 'open'::text)) THEN 0
        ELSE GREATEST(0, EXTRACT(day FROM now() - COALESCE(l.last_activity, now()))::integer)
    END AS alert_days,
    -- ===== أعمدة الفلترة الجديدة (مضافة في النهاية) =====
    l.source_id,
    l.branch_id,
    l.procedure_interest,
    l.created_at,
    l.last_activity,
    l.phone_norm,
    l.offered_price,
    l.age,
    l.follow_paused,
    l.snooze_until,
    l.full_name,
    l.file_no
FROM leads l
LEFT JOIN stages s ON s.id = l.stage_id;