-- Per-user machine event log for usage tracking (Option C)
-- Events: created | started | suspended | deleted
-- Uptime = sum of intervals between paired started→suspended events per user

create table if not exists machine_events (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null,
  user_id     uuid not null,
  fly_app_name text,
  event       text not null,   -- created | started | suspended | deleted
  created_at  timestamptz not null default now()
);

create index if not exists machine_events_user_id   on machine_events(user_id);
create index if not exists machine_events_agent_id  on machine_events(agent_id);
create index if not exists machine_events_created_at on machine_events(created_at);

-- Convenience view: uptime seconds per user, computed from start/suspend pairs.
-- For each agent, pairs a 'started' event with the next 'suspended' or 'deleted'
-- event. Still-running agents (no closing event yet) contribute time up to now().
create or replace view user_uptime as
with events as (
  select
    user_id,
    agent_id,
    event,
    created_at,
    lead(created_at) over (partition by agent_id order by created_at) as next_at,
    lead(event)      over (partition by agent_id order by created_at) as next_event
  from machine_events
)
select
  user_id,
  round(sum(
    extract(epoch from
      coalesce(next_at, now()) - created_at
    )
  ))::bigint as uptime_seconds,
  count(distinct agent_id) as agent_count
from events
where event = 'started'
  and (next_event in ('suspended', 'deleted') or next_event is null)
group by user_id;
