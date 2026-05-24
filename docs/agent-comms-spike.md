# Agent-to-Agent Communication Spike

## Goal

Prove that Agent A can send a task to Agent B while B is suspended, B wakes
automatically, processes the task non-interactively, and posts the result back.
$0 at rest.

## Architecture

```
Browser (Vercel)
  └── Supabase JS client (anon key, RLS controls access)
        ├── agents table  — registry, self-registered on boot
        └── messages table — task queue, source of truth

Supabase
  ├── Postgres — agents + messages schema
  ├── Realtime — agents subscribe to their own message rows
  ├── Database webhook — messages INSERT → wake-agent Edge Function
  └── Edge Function: wake-agent
        └── calls Fly Machines API to start suspended target machine

Fly machines (agents)
  ├── On boot: register self in Supabase via REST
  ├── On boot: query pending messages, run any found
  ├── Subscribe to Realtime for subsequent messages
  └── Handle message: claude -p "<payload>" → post result to Supabase
```

## Cost at rest

| Component | Idle cost |
|---|---|
| Fly agents (suspended) | $0.15/vol/month each |
| Supabase | $0 (free tier) |
| Vercel | $0 (free tier) |
| OpenRouter | $0 |
| **2-agent setup** | **~$0.30/month** |

## Prerequisites (human setup — see bottom of this doc)

- Supabase project created, URL + keys in `.env`
- Supabase CLI installed and linked to project
- Vercel project connected to GitHub repo, env vars set
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` set as Fly secrets

---

## Phase 1 — Supabase schema + wake function (~1 hour)

### 1a. Schema

Run in Supabase SQL editor or via migration:

```sql
create table agents (
  id uuid primary key default gen_random_uuid(),
  fly_app_name text unique not null,
  fly_machine_id text,
  fly_region text,
  kind text,           -- claude-agent | opencode-agent | shell-agent
  status text,         -- running | suspended
  last_seen timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  from_agent_id uuid references agents(id),
  to_agent_id uuid references agents(id) not null,
  payload text not null,
  status text default 'pending',  -- pending | processing | done | error
  result text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Allow agents and browser to read/write (tighten with RLS later)
alter table agents enable row level security;
alter table messages enable row level security;
create policy "public read/write agents" on agents for all using (true) with check (true);
create policy "public read/write messages" on messages for all using (true) with check (true);
```

### 1b. Edge Function: wake-agent

File: `supabase/functions/wake-agent/index.ts`

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";

const FLY_API_TOKEN = Deno.env.get("FLY_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const { record } = await req.json();            // message row from webhook
  const toAgentId = record.to_agent_id;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: agent } = await supabase
    .from("agents")
    .select("fly_app_name, fly_machine_id, status")
    .eq("id", toAgentId)
    .single();

  if (!agent) return new Response("agent not found", { status: 404 });
  if (agent.status === "running") return new Response("already running", { status: 200 });

  const { fly_app_name, fly_machine_id } = agent;
  const res = await fetch(
    `https://api.machines.dev/v1/apps/${fly_app_name}/machines/${fly_machine_id}/start`,
    { method: "POST", headers: { Authorization: `Bearer ${FLY_API_TOKEN}` } }
  );

  return new Response(
    JSON.stringify({ woke: res.ok, status: res.status }),
    { headers: { "Content-Type": "application/json" } }
  );
});
```

Deploy: `supabase functions deploy wake-agent`

Set secrets:
```bash
supabase secrets set FLY_API_TOKEN=<from .env>
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard>
```

### 1c. Database webhook

In Supabase dashboard → Database → Webhooks → Create:
- Table: `messages`
- Events: `INSERT`
- URL: `https://<project-ref>.supabase.co/functions/v1/wake-agent`
- HTTP headers: `Authorization: Bearer <service_role_key>`

---

## Phase 2 — Agent self-registration (~30 min)

Add to each agent startup script (after git/workspace setup, before launching the agent):

```bash
# Self-register in Supabase agent registry
if [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  AGENT_ID=$(curl -sf \
    -X POST "${SUPABASE_URL}/rest/v1/agents" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates,return=representation" \
    -d "{
      \"fly_app_name\": \"${FLY_APP_NAME}\",
      \"fly_machine_id\": \"${FLY_MACHINE_ID}\",
      \"fly_region\": \"${FLY_REGION}\",
      \"kind\": \"claude-agent\",
      \"status\": \"running\"
    }" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)[0]?.id||''))")
  export AGENT_ID
fi
```

Fly injects `FLY_APP_NAME`, `FLY_MACHINE_ID`, `FLY_REGION` automatically — no extra env vars needed for identity.

Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Fly secrets once (available to all machines):
```bash
~/.fly/bin/flyctl secrets set SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_ANON_KEY=<anon-key> \
  --app <any-agent-app>
```

Note: Fly secrets are per-app. Set them on each provisioned agent app, or update
`provisionAgent` in `server/fly-client.mjs` to set them via the GraphQL secrets API
at provision time (same pattern as OPENROUTER_API_KEY).

---

## Phase 3 — Message handling in agents (~1 hour)

Add `runtime/claude-agent/bin/message-handler` script:

```bash
#!/usr/bin/env bash
# Polls Supabase for pending messages and handles them

set -euo pipefail

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${AGENT_ID:-}" ]; then
  echo "message-handler: SUPABASE_URL or AGENT_ID not set, skipping"
  exit 0
fi

claim_and_run() {
  local msg_id="$1"
  local payload="$2"

  # Mark as processing
  curl -sf -X PATCH \
    "${SUPABASE_URL}/rest/v1/messages?id=eq.${msg_id}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"status":"processing"}' > /dev/null

  # Run claude non-interactively
  result=$(claude -p "$payload" --model claude-sonnet-4-5 2>&1) || result="error: $?"

  # Post result
  curl -sf -X PATCH \
    "${SUPABASE_URL}/rest/v1/messages?id=eq.${msg_id}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"done\",\"result\":$(echo "$result" | jq -Rs .)}" > /dev/null
}

# On startup: drain any pending messages (arrived while suspended)
pending=$(curl -sf \
  "${SUPABASE_URL}/rest/v1/messages?to_agent_id=eq.${AGENT_ID}&status=eq.pending" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}")

echo "$pending" | jq -c '.[]' | while read -r msg; do
  id=$(echo "$msg" | jq -r '.id')
  payload=$(echo "$msg" | jq -r '.payload')
  echo "message-handler: processing $id"
  claim_and_run "$id" "$payload"
done

echo "message-handler: startup drain complete"
```

Call this from the agent startup script before `exec claude`:
```bash
bash /usr/local/bin/message-handler &
```

(Realtime subscription for push delivery can be added as a follow-on — startup
drain is sufficient to prove the wakeup-and-process loop for the spike.)

---

## Phase 4 — Vercel deploy (~30 min)

1. Install Supabase JS client: `npm install @supabase/supabase-js`
2. Create `src/supabase.ts`:
   ```typescript
   import { createClient } from "@supabase/supabase-js";
   export const supabase = createClient(
     import.meta.env.VITE_SUPABASE_URL,
     import.meta.env.VITE_SUPABASE_ANON_KEY
   );
   ```
3. Update `App.tsx` to load agents/messages from Supabase instead of Fastify
4. Add Realtime subscription so agent status + message results update live
5. Add a "Send message" UI panel: pick target agent, type payload, insert row
6. Connect GitHub repo to Vercel, set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
7. Deploy

Keep local Fastify server for Fly provisioning — don't port that to Edge Functions yet.

---

## Phase 5 — End-to-end proof (~30 min)

1. Provision one claude-agent via existing local server
2. Let it suspend (close terminal tab)
3. Open Vercel frontend → Send message → target the claude-agent
4. Watch:
   - Supabase webhook fires → wake-agent Edge Function
   - Edge Function calls Fly start API
   - Machine wakes (~3-5s)
   - Startup script registers, drain loop finds pending message
   - `claude -p` runs, result posted back
   - Frontend updates live via Realtime subscription
5. Target: message sent → result visible in under 15 seconds from suspended

---

## Environment variables reference

### Local `.env` additions needed
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

### Fly secrets (set per agent app at provision time)
```
SUPABASE_URL
SUPABASE_ANON_KEY
```
Add these to `provisionAgent()` in `server/fly-client.mjs` alongside `OPENROUTER_API_KEY`.

### Supabase Edge Function secrets
```
FLY_API_TOKEN
SUPABASE_SERVICE_ROLE_KEY   (auto-available as SUPABASE_SERVICE_ROLE_KEY)
```

### Vercel environment variables
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

---

## What to do if this session ends mid-spike

1. Check which phase completed by looking at:
   - Supabase dashboard → whether `agents` + `messages` tables exist
   - `supabase/functions/wake-agent/` directory in repo
   - Whether `runtime/claude-agent/bin/message-handler` exists
   - Whether `src/supabase.ts` exists
2. Resume from the first incomplete phase
3. All code for each phase is in this document
