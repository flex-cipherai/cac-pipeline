-- ============================================================
-- Allow admin/sales to delete a lead (cascades to its notes,
-- stage history, booked slots, and any quotations tied to it).
-- Run in Supabase SQL Editor
-- ============================================================

create policy "Admin and sales can delete leads"
  on public.leads for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'sales')
    )
  );
