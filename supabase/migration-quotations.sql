-- ============================================================
-- Quotation Generator: quotations + quotation_items
-- Run in Supabase SQL Editor
-- ============================================================

-- Auto-numbering: SDFM-Q-0001, SDFM-Q-0002, ...
create sequence if not exists public.quotation_number_seq start 1;

create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  quote_number text not null unique default ('SDFM-Q-' || lpad(nextval('public.quotation_number_seq')::text, 4, '0')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'KES',
  tax_rate numeric not null default 0,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  payment_terms text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_price numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;

-- Quotations are a Sales Pipeline document — same admin/sales access as leads,
-- notifications, and the rest of that module (marketing has no route to it).
create policy "Admin and sales can view quotations"
  on public.quotations for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can insert quotations"
  on public.quotations for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can update quotations"
  on public.quotations for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can delete quotations"
  on public.quotations for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can view quotation items"
  on public.quotation_items for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can insert quotation items"
  on public.quotation_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can update quotation items"
  on public.quotation_items for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create policy "Admin and sales can delete quotation items"
  on public.quotation_items for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );

create trigger on_quotations_updated
  before update on public.quotations
  for each row execute function public.handle_updated_at();

create index if not exists quotations_lead_id_idx on public.quotations(lead_id);
create index if not exists quotation_items_quotation_id_idx on public.quotation_items(quotation_id);
