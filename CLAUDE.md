# AtlasLives Spike — Claude Code Instructions

This is a proof-of-concept for persistent browser terminals on Fly.io Machines.
The stack: Fastify API + Vite/React frontend + Fly Machines + Docker runtime images.

## Spike docs

- `docs/agent-comms-spike.md` — **next spike**: agent-to-agent messaging via Supabase
  + Vercel. Read this before starting any Supabase/messaging work.
- `docs/atlaslives-spike-plan.md` — original spike plan
- `docs/runtime-publish.md` — how runtime images are built and published

## Project layout

```
server/          Fastify API (workspaces, agents, Fly provisioning)
src/             React frontend (App.tsx)
runtime/
  shell-agent/   bash + ttyd runtime
  opencode-agent/ OpenCode (Gemini via OpenRouter) + ttyd
  claude-agent/  Claude Code (via OpenRouter proxy) + ttyd
scripts/         Dev tooling (see Dev workflow below)
```

## Dev workflow — use these, not manual steps

### Local server + frontend
```bash
npm run dev          # starts server (--watch) + vite, hot-reload on file save
```
Server auto-restarts on any change to `server/`. Frontend hot-reloads via Vite.
Never manually restart the server — `--watch` handles it.

### Deploy frontend to Vercel
```bash
npm run deploy       # builds + deploys to atlas-agents-spike.vercel.app
```
Vercel project: `atlas-lives-projects/atlas-agents-spike`
Live URL: https://atlas-agents-spike.vercel.app
Deploy goes directly from local build (no GitHub auto-deploy wired up yet).
Requires `VERCEL_TOKEN` in `.env`.

### Iterating on runtime scripts (fastest loop — ~5s, no Docker needed)
When you change files under `runtime/<kind>/bin/`:
```bash
npm run push-runtime <app-name>
# e.g. npm run push-runtime atlas-agent-1a0f2baedf
```
This base64-encodes each bin file, uploads via SSH, and restarts the tmux session.
Use this for any change to bash scripts, the node proxy, or agent startup logic.
Auto-detects agent kind from the app name (claude → claude-agent, etc.).

### Updating the Docker image on an existing machine (~2 min vs ~4 min reprovision)
When you change the Dockerfile or need new packages:
```bash
docker build --platform linux/amd64 -t registry.fly.io/<image>:latest runtime/<kind>/
docker push registry.fly.io/<image>:latest
npm run update-machine <app-name>
# e.g. npm run update-machine atlas-agent-1a0f2baedf
```
This patches the existing machine in place (keeps the volume, app, IPs).
Only provision a brand new machine when you need a fresh volume.

### Provisioning a brand new agent (when you need a clean slate)
```bash
node --input-type=module <<'EOF'
import { config } from './server/config.mjs';
import { provisionClaudeAgent, makeAgentFlyNames } from './server/fly-client.mjs';
const { appName, volumeName } = makeAgentFlyNames();
const result = await provisionClaudeAgent({ appName, volumeName, region: config.defaultRegion });
console.log(result);
EOF
```
Replace `provisionClaudeAgent` with `provisionShellAgent` or `provisionOpenCodeAgent` as needed.

## Agent kinds

| Kind | Image env var | Notes |
|------|--------------|-------|
| `shell-agent` | `FLY_RUNTIME_IMAGE` | bash + ttyd |
| `opencode-agent` | `FLY_OPENCODE_RUNTIME_IMAGE` | OpenCode + Gemini 2.5 Flash via OpenRouter |
| `claude-agent` | `FLY_CLAUDE_RUNTIME_IMAGE` | Claude Code via local OpenRouter proxy |
| `pi-agent` | `FLY_PI_RUNTIME_IMAGE` | pi.dev CLI via OpenRouter (Node 22 required) |

## Claude-agent specifics

Claude Code routes through a local model-ID proxy (`openrouter-proxy`) that:
1. Translates request model IDs (e.g. `claude-opus-4-7[1m]` → `anthropic/claude-opus-4.7`)
2. Forwards `anthropic-*` headers (`anthropic-beta`, etc.) to OpenRouter
3. Rewrites the response `model` field back to the requested ID so Claude Code's
   response validation passes (otherwise it shows "model not found / no access")

The proxy runs on `127.0.0.1:8082`. The Dockerfile sets
`ENV ANTHROPIC_BASE_URL=http://127.0.0.1:8082` — **do not override this as a Fly secret**.
Fly secrets win over Dockerfile ENV, so if you set `ANTHROPIC_BASE_URL` as a secret pointing
straight at OpenRouter, Claude Code bypasses the proxy entirely and every Anthropic model
ID (e.g. `claude-opus-4-7`) gets rejected by OpenRouter as "model not found".
Only `ANTHROPIC_API_KEY` should be a Fly secret. See `server/fly-client.mjs` —
the comment in `provisionAgent()` explains this.

**Updating model mappings:** `runtime/claude-agent/bin/openrouter-proxy` has `MODEL_MAP`.
Source of truth for OpenRouter IDs: `curl https://openrouter.ai/api/v1/models | jq '.data[].id'`
(filter for `anthropic/*`). Don't guess; OpenRouter naming (`claude-opus-4.7`) differs from
Claude Code's internal IDs (`claude-opus-4-7`).

**CLI flag warning:** `claude` CLI changes frequently. The startup script uses
`--append-system-prompt` (not `--system`, which was removed). If you rebuild and the TUI
fails to launch, check the Claude Code release notes.

**Picker tier filter:** flags like `opusProMigrationComplete:true` and
`sonnet1m45MigrationComplete:true` in `~/.claude.json` hide Opus from the `/model` picker
(Claude Code treats the account as Pro tier instead of Max). Don't add them back.

**Why `~/.claude.json` is baked into the image:** first-run onboarding dialogs and the
"custom API key" approval dialog block the TUI from starting. The startup script also
pre-approves the runtime API key suffix at boot via the same file.

## Agent-to-agent comms (Supabase spike)

Agents self-register in the Supabase `agents` table on boot (via `agent-register` script).
Message queue lives in the `messages` table. On INSERT, a database trigger calls the
`wake-agent` Edge Function, which starts the Fly machine if suspended.
Each agent runs `message-handler` in the background, polling for pending messages every 5s.
- `claude-agent`: runs `claude -p "$payload"` (AGENT_EXEC=claude)
- `shell-agent` / `opencode-agent`: runs `bash -c "$payload"` (AGENT_EXEC=bash)

### One-time setup (manual — DB connectivity is blocked locally)
1. Go to https://supabase.com/dashboard/project/nsqpzqyykpeqoyokwutb/sql
2. Paste the contents of `supabase/migrations/20260524000000_agent_comms.sql` and run it.
   This creates the agents + messages tables AND the wake-agent trigger in one shot.
   (The webhook trigger is embedded in the SQL using `supabase_functions.http_request`.)

Frontend: https://atlas-agents-spike.vercel.app
- Shows live agent registry (via Supabase Realtime)
- Shows message history with results
- Allows sending messages to any registered agent

## Secrets / env

API keys live in `.env` (local) and as Fly secrets (on machines).
Never store secrets in SQLite or return them in API responses.
`FLY_API_TOKEN` stays in the local backend only — never sent to the browser.
OpenRouter key is set once as a Fly secret during provisioning
(`OPENROUTER_API_KEY`, and `ANTHROPIC_API_KEY` for claude-agent only) and not stored
anywhere else. `ANTHROPIC_BASE_URL` is **NOT** a secret — it's set by the
claude-agent Dockerfile to point at the local proxy (see Claude-agent specifics).
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are set as Fly secrets at provisioning time
(included automatically in `provisionAgent()`).
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are in `.env` for local Vite dev;
baked into the frontend bundle at build time (anon key is safe to expose).
`ATLAS_GITHUB_TOKEN` is set as a Fly secret (not a plaintext env var) so it is
encrypted at rest and not readable via the Fly Machines REST API.

## Known security risks (acceptable for spike, must fix before production)

Any user with terminal access to a machine can run `printenv` and see all runtime
environment variables. Fly secrets are encrypted at rest but decrypted into the
process environment at boot — they are not hidden from the running process or anyone
with shell access.

| Secret | Exposure | Blast radius | Mitigation path |
|---|---|---|---|
| `ATLAS_GITHUB_TOKEN` | `printenv` on the machine | Push/delete code, access private repos scoped to the token | Scope PATs narrowly (contents:read+write only); rotate on agent delete |
| `COMPOSIO_API_KEY` | `printenv` on the machine | Account-level Composio calls — could list/disconnect other users' connections | Run Composio MCP server on Atlas backend (Option B); key never touches the machine |
| `OPENROUTER_API_KEY` | `printenv` on the machine | Spend against the user's $5 sub-key cap | Acceptable — cap limits damage; sub-key can be revoked |
| `SUPABASE_ANON_KEY` | `printenv` on the machine | Read/write within RLS-enforced rows only | Acceptable — anon key is intentionally public; RLS is the guard |

The `COMPOSIO_API_KEY` risk is the highest priority: it is an account-level key that
could be used to disconnect other users' OAuth connections or make cross-entity API
calls. The fix is to move the Composio MCP server off the Fly machine entirely and
run it as a remote service on the Atlas backend, so the key never appears in any
agent's environment.

## Debugging a running machine

```bash
# Capture tmux pane
FLY_API_TOKEN=$(grep FLY_API_TOKEN .env | cut -d= -f2-) ~/.fly/bin/flyctl ssh console -a <app> -C "tmux capture-pane -t atlas-agent -p -S -50"

# Send a command to the agent's tmux session
FLY_API_TOKEN=$(grep FLY_API_TOKEN .env | cut -d= -f2-) ~/.fly/bin/flyctl ssh console -a <app> -C "tmux send-keys -t atlas-agent '<command>' Enter"

# Check machine state
FLY_API_TOKEN=... curl -s -H "Authorization: Bearer $FLY_API_TOKEN" \
  "https://api.machines.dev/v1/apps/<app>/machines" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');JSON.parse(d).forEach(m=>console.log(m.id,m.state))"
```
