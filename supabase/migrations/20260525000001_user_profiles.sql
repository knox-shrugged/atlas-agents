-- Per-user profile: OpenRouter sub-key + admin flag
-- openrouter_key is stored server-side only and never returned to the client.
-- Set is_admin = true manually via Supabase dashboard for admin users.

create table if not exists user_profiles (
  user_id              uuid primary key,
  openrouter_key       text,          -- actual key, used for Fly secret provisioning
  openrouter_key_hash  text,          -- hash used to query OR usage API
  is_admin             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
