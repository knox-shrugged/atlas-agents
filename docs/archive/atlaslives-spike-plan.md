# AtlasLives Runtime Continuity Spike Plan

## Goal

Prove the smallest end-to-end AtlasLives flow:

1. Open a browser UI.
2. Create a workspace.
3. Create one simple agent runtime.
4. Open an interactive browser terminal connected to that runtime.
5. Type commands and create observable shell state.
6. Suspend the runtime.
7. Resume the runtime.
8. Reconnect and verify the same working context is still available.

This spike intentionally does not include LLM inference, GitHub integration, billing, multi-agent orchestration, model gateways, approvals, or team/org features.

## Product Thesis Being Tested

The core product bet is that persistent autonomous coding workspaces are more valuable than temporary chat sessions. This spike tests the infrastructure and UX foundation for that bet: a user can create a cloud runtime, interact with it through a browser terminal, pause it, and return later without losing the working context.

## Stack

- Frontend: Vite + React + TypeScript
- Backend: Node.js + Fastify
- Local state: SQLite
- Cloud runtime: Fly.io Machines
- Runtime persistence: Fly Volumes mounted at `/data`
- Terminal multiplexer: `tmux`
- Browser terminal transport: `ttyd`
- Initial agent type: `shell-agent`

## Required Accounts And Secrets

Required for this spike:

- Fly.io account
- Fly.io billing organization with payment method
- Fly.io API token with permission to create apps, machines, volumes, and suspend/resume machines

Not required for this spike:

- OpenAI account
- Anthropic account
- OpenRouter account
- GitHub account
- Neon/Postgres account
- Stripe account

Local environment variables:

```bash
FLY_API_TOKEN=...
FLY_ORG_SLUG=...
ATLAS_DEFAULT_REGION=den
```

`ATLAS_DEFAULT_REGION` can be changed, but the spike should use one fixed Fly region to keep volume and machine placement predictable.

## High-Level Architecture

```text
Browser UI
  Vite React app
  |
  v
Control API
  Fastify
  SQLite
  Fly client
  |
  v
Fly Runtime
  one Fly app per agent for the spike
  one Fly Machine per agent
  one Fly Volume per agent
  tmux session named atlas-agent
  ttyd exposes tmux through browser terminal
```

## Why One Fly App Per Agent

For the first spike, use one Fly app per agent. This avoids routing complexity and gives each terminal a simple stable hostname:

```text
https://<agent-fly-app>.fly.dev
```

This is less efficient than a shared multi-machine app, but it is the simplest way to prove the flow. A later architecture pass can consolidate many machines behind one app/control plane once the runtime behavior is proven.

## Runtime Contract

Each runtime starts from a small Docker image containing:

- `bash`
- `git`
- `curl`
- `ca-certificates`
- `tmux`
- `ttyd`
- `atlas-agent`

The runtime mounts a Fly Volume at:

```text
/data
```

The working directory is:

```text
/data/workspace
```

The persistent terminal session is:

```text
tmux session: atlas-agent
```

The runtime startup command should:

```bash
mkdir -p /data/workspace
cd /data/workspace

tmux has-session -t atlas-agent 2>/dev/null || \
  tmux new-session -d -s atlas-agent "atlas-agent start"

exec ttyd --writable --port 7681 tmux attach-session -t atlas-agent
```

## Initial `atlas-agent` Behavior

`atlas-agent` is a deterministic no-LLM shell agent. It exists to prove lifecycle and terminal continuity without provider dependencies.

Minimum behavior:

```bash
atlas-agent start
```

Expected behavior:

- prints workspace metadata
- ensures `/data/workspace` exists
- writes a startup line to `/data/agent.log`
- starts an interactive shell in `/data/workspace`

Example output:

```text
AtlasLives shell-agent
Workspace: /data/workspace
Session: atlas-agent
Persistence: /data

Try:
  echo hello > /data/workspace/proof.txt
  export ATLAS_PROOF=still-here
```

## Minimal Data Model

### Workspace

```text
id
name
created_at
updated_at
```

### Agent

```text
id
workspace_id
name
kind
status
fly_app_name
fly_machine_id
fly_volume_name
fly_region
terminal_url
created_at
updated_at
last_error
```

Initial allowed `kind`:

```text
shell-agent
```

Initial statuses:

```text
creating
running
suspending
suspended
resuming
error
```

## Backend API

### Workspaces

```http
POST /api/workspaces
GET /api/workspaces
GET /api/workspaces/:workspaceId
```

`POST /api/workspaces` body:

```json
{
  "name": "Demo Workspace"
}
```

### Agents

```http
POST /api/workspaces/:workspaceId/agents
GET /api/agents/:agentId
POST /api/agents/:agentId/refresh
POST /api/agents/:agentId/suspend
POST /api/agents/:agentId/resume
```

`POST /api/workspaces/:workspaceId/agents` body:

```json
{
  "name": "Shell Agent",
  "kind": "shell-agent"
}
```

## UI

Use one minimalist page for the spike.

### Workspace Area

- Create workspace button
- Workspace name input
- Current workspace display

### Agent Area

- Create agent button
- Agent name
- Agent kind
- Agent status
- Fly app name
- Fly machine ID
- Terminal URL

### Runtime Controls

- Refresh status
- Open terminal
- Suspend
- Resume

### Terminal Embed

Start with one of these, in order:

1. Open `ttyd` terminal in a new tab.
2. If headers/auth allow it cleanly, embed `ttyd` in an iframe.
3. Later, replace direct `ttyd` UI with `xterm.js` if product control requires it.

For the spike, a new-tab terminal is acceptable.

## Fly Provisioning Flow

When the user creates an agent:

1. Generate a unique Fly app name.
2. Create the Fly app in the configured organization.
3. Create a Fly Volume for the agent in the configured region.
4. Create a Fly Machine using the runtime image.
5. Attach the volume at `/data`.
6. Expose `ttyd` on port `7681`.
7. Store Fly identifiers in SQLite.
8. Poll machine status until running.
9. Return the terminal URL.

Example generated names:

```text
app: atlas-agent-<short-id>
volume: atlas_data_<short_id>
machine name: shell-agent
```

## Runtime Image

Create a runtime Dockerfile under:

```text
runtime/shell-agent/Dockerfile
```

The image should be as small and boring as possible. Debian slim is acceptable for the spike because package installation is straightforward.

Required runtime files:

```text
runtime/shell-agent/Dockerfile
runtime/shell-agent/bin/atlas-agent
runtime/shell-agent/bin/runtime-entrypoint
```

## Demo Script

The successful demo should look like this:

1. Start the local app.
2. Open `http://localhost:5173`.
3. Click `Create workspace`.
4. Click `Create agent`.
5. Wait for status `running`.
6. Open the browser terminal.
7. In the terminal, run:

```bash
pwd
echo "hello from atlas" > /data/workspace/proof.txt
export ATLAS_PROOF=still-here
tmux display-message "atlas session alive"
```

8. In the UI, click `Suspend`.
9. Wait for status `suspended`.
10. In the UI, click `Resume`.
11. Wait for status `running`.
12. Reopen terminal.
13. Verify:

```bash
cat /data/workspace/proof.txt
echo "$ATLAS_PROOF"
tmux ls
```

Success has two levels:

- Level 1: `/data/workspace/proof.txt` survives. This proves volume persistence.
- Level 2: `$ATLAS_PROOF` survives. This proves true suspend/resume memory and process continuity.

Level 2 is the important product proof.

## Milestones

### Milestone 1: Local Control Plane

Deliverables:

- Vite React app boots locally.
- Fastify API boots locally.
- SQLite database initializes.
- UI can create a workspace.
- UI can create a fake local agent record.

Acceptance:

- `http://localhost:5173` shows workspace and agent controls.
- Created records persist across server restarts.

### Milestone 2: Runtime Image

Deliverables:

- Runtime Docker image builds.
- Image includes `tmux`, `ttyd`, and `atlas-agent`.
- Container can be run locally.

Acceptance:

- Local container starts `ttyd`.
- Browser terminal opens.
- Commands typed in the browser execute inside `tmux`.

### Milestone 3: Manual Fly Runtime

Deliverables:

- Runtime image deploys to Fly manually.
- Fly Machine runs with attached volume.
- Browser terminal is reachable.

Acceptance:

- User can open Fly terminal URL.
- User can write a file under `/data/workspace`.
- User can reconnect without killing the shell session.

### Milestone 4: UI-Created Fly Agent

Deliverables:

- Backend can create Fly app, volume, and machine from API call.
- UI can create an agent and show terminal URL.
- UI can refresh machine status.

Acceptance:

- User creates a workspace and agent entirely from the browser UI.
- Terminal opens successfully.

### Milestone 5: Suspend And Resume

Deliverables:

- UI suspend button calls Fly suspend.
- UI resume button calls Fly start/resume.
- Status polling reflects lifecycle changes.

Acceptance:

- User creates terminal state.
- User suspends the machine.
- User resumes the machine.
- User reconnects to the same `tmux` session.
- `/data/workspace/proof.txt` survives.
- `$ATLAS_PROOF` survives if Fly restored from suspend snapshot rather than cold start.

## Security Notes For The Spike

This is a local spike, not production security.

Do:

- Keep `FLY_API_TOKEN` only in the local backend environment.
- Do not send `FLY_API_TOKEN` to the browser.
- Avoid putting provider API keys in the runtime.
- Treat terminal URLs as sensitive.
- Add a clear warning in code comments that public unauthenticated terminals are not production safe.

Defer:

- User auth
- Signed terminal URLs
- Per-terminal authorization
- Audit logs
- Secret scoping
- Network egress controls

These become mandatory before a real hosted version.

## Explicit Non-Goals

- No LLM inference.
- No Claude Code.
- No OpenCode.
- No Codex CLI.
- No GitHub integration.
- No model gateway.
- No billing UI.
- No organization/team support.
- No multi-agent orchestration.
- No shared filesystem between agents.
- No autonomous PR creation or merging.
- No xterm.js unless direct `ttyd` UI is insufficient.

## Follow-On Spikes

After this succeeds, run separate spikes for:

1. GitHub clone, branch creation, commit, and push.
2. Claude Code runtime adapter.
3. OpenCode runtime adapter.
4. Codex runtime adapter.
5. Terminal auth and signed session routing.
6. Shared control-plane deployment.
7. Multi-agent workspace dashboard.

