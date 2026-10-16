-- ============================================================
-- Inquiries — track enquiries until they become leads (safe to re-run)
--
-- An inquiry is someone who has reached out (WhatsApp, phone, email,
-- LinkedIn, a referral, an event ...) but is not a lead yet: nobody has
-- booked a discovery call or been scored. Staff log them, work them to a
-- decision, and either convert them into a lead or close them with a reason.
--
--   inquiries            one row per enquiry, with its status and follow-up date
--   inquiry_activities   the timeline: notes, calls, WhatsApp, emails, status changes
--   convert_inquiry_to_lead()   creates the lead and closes the loop in one transaction
--
-- Access follows Settings → Permissions (module 'inquiries') through has_module_access(); admin
-- always has it, and only admin can delete. The public website never touches these tables.
--
-- Run in the Supabase SQL Editor after schema.sql, migration-booking-flow.sql (the conversion uses
-- leads.challenge_notes and leads.nudge_sent_at) and migration-role-permissions.sql (has_module_access).
-- ============================================================


-- 1. Inquiries ---------------------------------------------------------------

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),

  -- Who
  full_name text not null,
  company_name text,
  email text,
  phone text,
  has_whatsapp boolean not null default false,

  -- Where it came from. channel is how they reached out; source_detail is the
  -- free-text "who referred them / which post / which event".
  channel text not null default 'other'
    check (channel in ('whatsapp', 'phone', 'email', 'linkedin', 'referral', 'event', 'website', 'other')),
  source_detail text,

  -- What they asked
  message text,

  -- Where it is now. converted = it became a lead (lead_id says which);
  -- closed = it ended without one (close_reason says why).
  status text not null default 'new'
    check (status in ('new', 'contacted', 'engaged', 'converted', 'closed')),
  close_reason text
    check (close_reason is null or close_reason in
      ('no_response', 'not_a_fit', 'not_interested', 'duplicate', 'spam', 'other')),

  assigned_to uuid references public.profiles(id) on delete set null,
  next_follow_up date,

  -- Timing. received_at is when they reached out (staff may backdate it);
  -- first_response_at is when we first got back to them, which drives the
  -- response-time report. Both the touch columns are maintained by the trigger below.
  received_at timestamptz not null default now(),
  first_response_at timestamptz,
  last_contact_at timestamptz,
  converted_at timestamptz,
  closed_at timestamptz,

  lead_id uuid references public.leads(id) on delete set null,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inquiries_reachable check (
    coalesce(btrim(email), '') <> '' or coalesce(btrim(phone), '') <> ''
  )
);

create index if not exists inquiries_status_idx on public.inquiries (status, received_at desc);
create index if not exists inquiries_follow_up_idx on public.inquiries (next_follow_up)
  where status in ('new', 'contacted', 'engaged');
create index if not exists inquiries_email_lower_idx on public.inquiries (lower(email));
create index if not exists inquiries_phone_idx on public.inquiries (phone);
create index if not exists inquiries_lead_idx on public.inquiries (lead_id);

drop trigger if exists on_inquiries_updated on public.inquiries;
create trigger on_inquiries_updated
  before update on public.inquiries
  for each row execute function public.handle_updated_at();


-- 2. Activity timeline -------------------------------------------------------
-- 'call', 'whatsapp', 'email' and 'meeting' are touches: the team spoke to the
-- person. A touch stamps the inquiry (see the trigger). 'note' and 'status' do not.

create table if not exists public.inquiry_activities (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  kind text not null
    check (kind in ('note', 'call', 'whatsapp', 'email', 'meeting', 'status')),
  body text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inquiry_activities_inquiry_idx
  on public.inquiry_activities (inquiry_id, created_at desc);

create or replace function public.handle_inquiry_touch()
returns trigger
language plpgsql
as $$
begin
  if new.kind in ('call', 'whatsapp', 'email', 'meeting') then
    update public.inquiries
    set last_contact_at = greatest(coalesce(last_contact_at, new.created_at), new.created_at),
        first_response_at = coalesce(first_response_at, new.created_at),
        -- Only a brand-new inquiry moves on its own; converted/closed ones stay put.
        status = case when status = 'new' then 'contacted' else status end
    where id = new.inquiry_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_inquiry_activity_touch on public.inquiry_activities;
create trigger on_inquiry_activity_touch
  after insert on public.inquiry_activities
  for each row execute function public.handle_inquiry_touch();


-- 3. Row level security: whoever has the 'inquiries' module (admin always) --------------------------------

alter table public.inquiries enable row level security;
alter table public.inquiry_activities enable row level security;

drop policy if exists "Admin and sales can view inquiries" on public.inquiries;
create policy "Admin and sales can view inquiries"
  on public.inquiries for select to authenticated
  using (public.has_module_access('inquiries'));

drop policy if exists "Admin and sales can add inquiries" on public.inquiries;
create policy "Admin and sales can add inquiries"
  on public.inquiries for insert to authenticated
  with check (public.has_module_access('inquiries'));

drop policy if exists "Admin and sales can update inquiries" on public.inquiries;
create policy "Admin and sales can update inquiries"
  on public.inquiries for update to authenticated
  using (public.has_module_access('inquiries'))
  with check (public.has_module_access('inquiries'));

drop policy if exists "Admins can delete inquiries" on public.inquiries;
create policy "Admins can delete inquiries"
  on public.inquiries for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "Admin and sales can view inquiry activities" on public.inquiry_activities;
create policy "Admin and sales can view inquiry activities"
  on public.inquiry_activities for select to authenticated
  using (public.has_module_access('inquiries'));

drop policy if exists "Admin and sales can add inquiry activities" on public.inquiry_activities;
create policy "Admin and sales can add inquiry activities"
  on public.inquiry_activities for insert to authenticated
  with check (public.has_module_access('inquiries'));
-- Activities are a log: no update or delete policy (they go when the inquiry is deleted).


-- 4. Convert an inquiry into a lead ------------------------------------------
-- One transaction, so a failure cannot leave a lead behind with the inquiry still
-- open (which would create a duplicate the next time someone retried).
--
-- The new lead starts 'unscored' (nobody has answered the prep questions) and,
-- unless staff pick a pipeline stage, 'Incomplete' (a lead to follow up that has no
-- call booked yet). nudge_sent_at is stamped so the automatic "finish booking your
-- call" email does not go to someone the team is already talking to.

create or replace function public.convert_inquiry_to_lead(
  p_inquiry_id uuid,
  p_full_name text,
  p_company_name text,
  p_email text,
  p_phone text,
  p_has_whatsapp boolean,
  p_classification text,
  p_stage text,
  p_source text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inq public.inquiries%rowtype;
  v_lead_id uuid;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_company text := btrim(coalesce(p_company_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_stage text := coalesce(nullif(btrim(coalesce(p_stage, '')), ''), 'Incomplete');
  v_class text := coalesce(nullif(btrim(coalesce(p_classification, '')), ''), 'unscored');
  v_note text;
begin
  if v_uid is null or not public.has_module_access('inquiries') then
    raise exception 'You do not have access to inquiries' using errcode = '42501';
  end if;

  if v_name = '' or v_company = '' or v_email = '' or v_phone = '' then
    raise exception 'Name, company, email and phone are all required to create a lead';
  end if;
  if v_class not in ('hot', 'warm', 'cold', 'unscored') then
    raise exception 'Unknown classification: %', v_class;
  end if;

  select * into v_inq from public.inquiries where id = p_inquiry_id for update;
  if not found then
    raise exception 'Inquiry not found';
  end if;
  if v_inq.status = 'converted' or v_inq.lead_id is not null then
    raise exception 'This inquiry has already been converted';
  end if;

  insert into public.leads
    (full_name, company_name, email, phone, has_whatsapp, classification,
     current_stage, source, challenge_notes, nudge_sent_at)
  values
    (v_name, v_company, v_email, v_phone, coalesce(p_has_whatsapp, false), v_class,
     v_stage, coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'Other'),
     left(v_inq.message, 1000), now())
  returning id into v_lead_id;

  insert into public.lead_stage_history (lead_id, stage, moved_by)
  values (v_lead_id, v_stage, v_uid);

  v_note := 'Converted from an inquiry received via ' || v_inq.channel || ' on '
            || to_char(v_inq.received_at at time zone 'UTC', 'DD Mon YYYY')
            || coalesce(case when btrim(coalesce(v_inq.source_detail, '')) <> '' then ' (' || v_inq.source_detail || ')' end, '')
            || coalesce(case when btrim(coalesce(v_inq.message, '')) <> '' then E'.\n\n' || v_inq.message end, '.');
  insert into public.lead_notes (lead_id, note, created_by)
  values (v_lead_id, v_note, v_uid);

  update public.inquiries
  set status = 'converted',
      lead_id = v_lead_id,
      converted_at = now(),
      closed_at = null,
      close_reason = null,
      next_follow_up = null
  where id = p_inquiry_id;

  insert into public.inquiry_activities (inquiry_id, kind, body, created_by)
  values (p_inquiry_id, 'status', 'Converted to a lead (' || v_stage || ')', v_uid);

  return v_lead_id;
end;
$$;

revoke all on function public.convert_inquiry_to_lead(uuid, text, text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.convert_inquiry_to_lead(uuid, text, text, text, text, boolean, text, text, text) to authenticated;


-- Review: both tables should show only the policies above.
select tablename, policyname, cmd
from pg_policies
where tablename in ('inquiries', 'inquiry_activities')
order by tablename, cmd, policyname;
