-- Fix user_uptime view: use workspace_agents.updated_at as the interval end for
-- currently-suspended agents instead of now(), so machines auto-suspended by Fly
-- don't keep accumulating uptime between user-initiated refreshes.
create or replace view user_uptime as
with events as (
  select
    me.user_id,
    me.agent_id,
    me.event,
    me.created_at,
    lead(me.created_at) over (partition by me.agent_id order by me.created_at) as next_at,
    lead(me.event)      over (partition by me.agent_id order by me.created_at) as next_event
  from machine_events me
)
select
  e.user_id,
  round(sum(
    extract(epoch from
      coalesce(
        e.next_at,
        case
          when wa.status in ('suspended', 'error') then wa.updated_at
          else now()
        end
      ) - e.created_at
    )
  ))::bigint as uptime_seconds,
  count(distinct e.agent_id) as agent_count
from events e
left join workspace_agents wa on wa.id = e.agent_id
where e.event = 'started'
  and (e.next_event in ('suspended', 'deleted') or e.next_event is null)
group by e.user_id;
