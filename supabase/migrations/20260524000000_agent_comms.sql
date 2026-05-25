-- Agent registry and message queue for agent-to-agent communication

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  fly_app_name text unique not null,
  fly_machine_id text,
  fly_region text,
  kind text not null,           -- claude-agent | opencode-agent | shell-agent
  status text not null default 'running',  -- running | suspended
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  from_agent_id uuid references agents(id),
  to_agent_id uuid references agents(id) not null,
  payload text not null,
  status text not null default 'pending',  -- pending | processing | done | error
  result text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast pending message lookup per agent
create index if not exists messages_to_agent_status
  on messages(to_agent_id, status);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists messages_updated_at on messages;
create trigger messages_updated_at
  before update on messages
  for each row execute function update_updated_at();

-- Permissive RLS for spike (tighten later with workspace isolation)
alter table agents enable row level security;
alter table messages enable row level security;

drop policy if exists "spike_agents_all" on agents;
drop policy if exists "spike_messages_all" on messages;

create policy "spike_agents_all" on agents for all using (true) with check (true);
create policy "spike_messages_all" on messages for all using (true) with check (true);

-- Enable pg_net for async HTTP from triggers
create extension if not exists pg_net schema extensions;

-- Trigger function: fires wake-agent Edge Function on every new message
create or replace function public.notify_wake_agent()
returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://nsqpzqyykpeqoyokwutb.supabase.co/functions/v1/wake-agent',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SUPABASE_FUNCTION_SECRET>"}'::jsonb,
    body := to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists messages_wake_agent on messages;
create trigger messages_wake_agent
  after insert on messages
  for each row execute function public.notify_wake_agent();

-- Enable Supabase Realtime for both tables
alter publication supabase_realtime add table agents;
alter publication supabase_realtime add table messages;
