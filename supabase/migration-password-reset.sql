-- ============================================================
-- Custom password reset flow: token storage + email template.
-- Run in Supabase SQL Editor
-- ============================================================

-- Tokens are generated/verified only by the request-password-reset and
-- confirm-password-reset Edge Functions (service role), so RLS is enabled
-- with NO policies at all — anon/authenticated get zero access either way.
create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_password_reset_tokens_hash on public.password_reset_tokens(token_hash);
create index if not exists idx_password_reset_tokens_user on public.password_reset_tokens(user_id);

alter table public.password_reset_tokens enable row level security;

-- Seeded ACTIVE (unlike the reminder placeholders) since password reset must
-- work out of the box — edit the copy on the Notifications page any time.
insert into public.email_templates
  (template_key, name, recipient_type, description, subject, body_html, is_active, available_variables)
values
('password_reset', 'Password Reset', 'client',
 'Sent when someone requests a password reset, or when an admin creates/resets a team account. Contains the one-time reset link.',
 'Reset Your SDFM Group Password',
 '<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #201E1D;">
  <div style="padding: 32px 0 24px; text-align: center;">
    <span style="font-size: 22px; font-weight: 700; color: #EC3013;">SDFM GROUP</span>
    <span style="font-size: 12px; display: block; letter-spacing: 0.15em; color: #201E1D;">LIMITED</span>
  </div>
  <div style="background: #F3F2F2; border-radius: 10px; padding: 32px; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 700; margin: 0 0 16px;">Reset Your Password</h1>
    <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0 0 24px;">Hi {{full_name}}, we received a request to reset your password. Click below to choose a new one. This link expires in {{expires_in}}.</p>
    <div style="text-align: center; margin: 0 0 8px;">
      <a href="{{reset_link}}" style="display: inline-block; background: #EC3013; color: white; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600;">Reset Password</a>
    </div>
    <p style="font-size: 12px; color: #999; margin: 24px 0 0;">If you did not request this, you can safely ignore this email.</p>
  </div>
  <p style="font-size: 12px; color: #999; text-align: center;">SDFM Group Limited · Transforming Kenyan Businesses</p>
</div>',
 true,
 ARRAY['full_name','email','reset_link','expires_in'])

on conflict (template_key) do nothing;
