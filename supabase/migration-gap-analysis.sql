-- ============================================================
-- Gap analysis migrations: follow_up_date + stage_entered_at
-- Run in Supabase SQL Editor
-- ============================================================

-- Gap 4: Follow-up reminder date
alter table public.leads add column if not exists follow_up_date date;

-- Gap 3: Track when a lead entered its current stage (for aging)
alter table public.leads add column if not exists stage_entered_at timestamptz default now();

-- Update existing leads: set stage_entered_at to updated_at as a baseline
update public.leads set stage_entered_at = coalesce(updated_at, created_at) where stage_entered_at is null;

-- Create a trigger to auto-update stage_entered_at when current_stage changes
create or replace function public.handle_stage_change()
returns trigger as $$
begin
  if OLD.current_stage is distinct from NEW.current_stage then
    NEW.stage_entered_at = now();
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists on_lead_stage_change on public.leads;
create trigger on_lead_stage_change
  before update on public.leads
  for each row execute function public.handle_stage_change();
