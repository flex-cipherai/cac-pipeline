-- ============================================================
-- CAC Sales Pipeline Management System — Database Schema
-- Run this in the Supabase SQL Editor (all at once)
-- ============================================================

-- 1. Profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null check (role in ('admin', 'sales', 'marketing')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Profiles policies
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Admins can insert profiles"
  on public.profiles for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can update profiles"
  on public.profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- 2. Leads
create table public.leads (
  id uuid primary key default gen_random_uuid(),

  -- Contact details
  full_name text not null,
  company_name text not null,
  email text not null,
  phone text not null,
  has_whatsapp boolean default false,

  -- Qualification responses (stored as the selected option text)
  q1_revenue text,
  q2_challenge text,
  q3_role text,
  q4_priority text,
  q5_timeline text,

  -- Scoring
  q1_score integer default 0,
  q2_score integer default 0,
  q3_score integer default 0,
  q4_score integer default 0,
  q5_score integer default 0,
  total_score integer default 0,

  -- Classification and qualification
  classification text not null check (classification in ('hot', 'warm', 'cold')),
  is_disqualified boolean default false,
  disqualifier_reason text,

  -- Pipeline tracking
  current_stage text default 'Scheduled',
  is_lost boolean default false,
  lost_reason text,

  -- Scheduling
  scheduled_day text,
  scheduled_time text,
  scheduled_date date,

  -- Source tracking
  source text default 'Website',

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.leads enable row level security;

-- Leads: anyone can insert (public form submission)
create policy "Anyone can submit a lead"
  on public.leads for insert
  to anon, authenticated
  with check (true);

-- Leads: only authenticated users can view
create policy "Authenticated users can view leads"
  on public.leads for select
  to authenticated
  using (true);

-- Leads: only admin and sales can update
create policy "Admin and sales can update leads"
  on public.leads for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );


-- 3. Lead Stage History
create table public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  stage text not null,
  entered_at timestamptz default now(),
  moved_by uuid references public.profiles(id)
);

alter table public.lead_stage_history enable row level security;

create policy "Authenticated users can view stage history"
  on public.lead_stage_history for select
  to authenticated
  using (true);

create policy "Stage history can be inserted by system or auth users"
  on public.lead_stage_history for insert
  to anon, authenticated
  with check (true);


-- 4. Lead Notes
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  note text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

alter table public.lead_notes enable row level security;

create policy "Authenticated users can view notes"
  on public.lead_notes for select
  to authenticated
  using (true);

create policy "Admin and sales can insert notes"
  on public.lead_notes for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );


-- 5. Calendar Availability
create table public.calendar_availability (
  id uuid primary key default gen_random_uuid(),
  day_of_week integer not null check (day_of_week between 1 and 5),
  time_slot text not null,
  is_available boolean default true
);

alter table public.calendar_availability enable row level security;

-- Anyone can view availability (needed for public form)
create policy "Anyone can view calendar availability"
  on public.calendar_availability for select
  to anon, authenticated
  using (true);

create policy "Admins can manage calendar availability"
  on public.calendar_availability for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Seed default availability: Mon-Fri, 09:00-11:00 and 14:00-16:00
-- (Wednesday ends at 15:00, Friday ends at 14:00 — matching your UI)
insert into public.calendar_availability (day_of_week, time_slot) values
  -- Monday (1)
  (1, '09:00'), (1, '10:00'), (1, '11:00'), (1, '14:00'), (1, '15:00'), (1, '16:00'),
  -- Tuesday (2)
  (2, '09:00'), (2, '10:00'), (2, '11:00'), (2, '14:00'), (2, '15:00'), (2, '16:00'),
  -- Wednesday (3)
  (3, '09:00'), (3, '10:00'), (3, '11:00'), (3, '14:00'), (3, '15:00'),
  -- Thursday (4)
  (4, '09:00'), (4, '10:00'), (4, '11:00'), (4, '14:00'), (4, '15:00'), (4, '16:00'),
  -- Friday (5)
  (5, '09:00'), (5, '10:00'), (5, '11:00'), (5, '14:00');


-- 6. Booked Slots (prevents double-booking)
create table public.booked_slots (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  slot_date date not null,
  time_slot text not null,
  day_of_week integer not null,
  created_at timestamptz default now(),
  unique (slot_date, time_slot)
);

alter table public.booked_slots enable row level security;

create policy "Anyone can view booked slots"
  on public.booked_slots for select
  to anon, authenticated
  using (true);

create policy "Anyone can insert booked slots"
  on public.booked_slots for insert
  to anon, authenticated
  with check (true);


-- 7. Auto-update updated_at on leads
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger on_leads_updated
  before update on public.leads
  for each row execute function public.handle_updated_at();


-- 8. Create the first admin user function
-- (Called after the admin signs up via Supabase Auth)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'admin')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
