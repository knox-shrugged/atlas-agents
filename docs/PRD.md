# AtlasLives — Product Requirements Document

**Status:** V1 in progress — UI shell complete
**Last updated:** May 2026
**Spike repo:** knox-shrugged/atlas-agents

---

## 1. Product Thesis

Persistent autonomous AI coding agents are more valuable than temporary chat sessions.

Today's AI coding tools are stateless — every session starts fresh, loses context, and requires the human to re-orient the model. AtlasLives inverts this: agents are always-on, always-aware, and always-ready. Users create workspaces containing specialized agents that run continuously, execute long-horizon tasks autonomously, and coordinate with each other without human intermediation.

The human's role shifts from driver to supervisor.

---

## 2. What the Spike Proved

The spike validated the core technical bets:

| Bet | Result |
|-----|--------|
| Fly Machines can host persistent browser terminals | ✅ ttyd + tmux running on Fly, accessible via HTTPS |
| Suspend/resume preserves agent state | ✅ tmux session frozen on suspend, restored on resume |
| Agents can self-register and receive messages | ✅ Supabase registry + message queue working end-to-end |
| A DB trigger can wake a suspended machine | ✅ INSERT → pg_net → Edge Function → Fly start API, 4s wake time |
| Streaming output is achievable | ✅ message-handler patches result column every 1s while command runs |
| Agents can discover and message each other | ✅ send-message / wait-for-reply / agent-lookup scripts on all runtimes |
| Claude Code can act as a coordinator | ✅ coordinator system prompt + shell dispatch working |
| Multiple agent kinds can coexist | ✅ shell-agent, opencode-agent, claude-agent all provisioned and running |

**Core magic confirmed:** suspend a machine, send it a message, it wakes in ~4 seconds, processes the task, streams the result back. The human never touches the machine.

---

## 3. V1 Product Scope

### 3.1 Workspaces
- Users create named workspaces as the top-level operational boundary
- A workspace contains one or more agents
- Workspace state persists indefinitely (Fly Volumes survive suspend/resume)

### 3.2 Agents
- Three kinds: `shell-agent` (bash), `opencode-agent` (Gemini via OpenRouter), `claude-agent` (Claude Code via OpenRouter)
- Each agent runs in an isolated Fly Machine with a dedicated volume
- Agents auto-register in the registry on boot
- Agents auto-suspend when idle (autostop), auto-wake on incoming message
- Agents have a persistent browser terminal accessible via HTTPS

### 3.3 Task Assignment
- Users send messages to agents from the dashboard
- Messages are queued in Supabase and processed in order
- Results stream back to the UI in real time as the agent produces output
- Long-running tasks survive suspend/resume cycles (tmux persistence)

### 3.4 Multi-Agent Coordination
- Agents can discover other agents by kind (`agent-lookup`)
- Agents can dispatch subtasks to each other (`send-message`)
- Agents can block on subtask completion and receive results (`wait-for-reply`)
- A coordinator agent (claude-agent) can orchestrate a fleet of shell/code agents

### 3.5 GitHub Integration
- Agents can be provisioned with a GitHub repo — cloned on first boot
- Git user name/email configured per agent
- Agents can push branches, open PRs, post comments via the GitHub API

### 3.6 Operational Dashboard
- Dark sidebar navigation: Agents, Messages, Registry, Costs
- Agent list per workspace; clicking an agent opens its terminal inline (iframe)
- Terminal tabs cached in the DOM — switching between agents is instant, no reconnect
- Refresh / suspend / resume controls in the header when an agent is selected
- Message composer + live history with streaming output and blinking cursor
- Live agent registry via Supabase Realtime
- Cost dashboard (OpenRouter, Fly.io, Vercel, Supabase)
- "New workspace" and "New agent" modals; agent modal stays open with progress message during Fly provisioning (~30s)

### 3.7 Atlas Model Gateway
- Agents never hold raw API keys — keys are injected as Fly secrets at provisioning time
- OpenRouter proxy on claude-agent translates model IDs before forwarding
- Per-workspace budget tracking (V1: via OpenRouter usage API)
- Support for Anthropic, OpenRouter; extensible to other providers

---

## 4. V1 Non-Goals

- Organization / team / multi-user support (single user for now)
- Autonomous PR merging without human approval
- Memory graphs or long-term semantic memory
- Complex workflow builders or DAG orchestration UI
- Advanced MCP coordination
- Shared filesystems between agents
- Billing UI or payment processing

---

## 5. Architecture

```
Browser (React/Vite)
  │
  ├── Fastify API (workspaces, agents, Fly provisioning)
  │     └── SQLite (local agent state)
  │
  ├── Supabase
  │     ├── agents table (registry, Realtime)
  │     ├── messages table (queue, Realtime)
  │     ├── pg_net trigger → wake-agent Edge Function
  │     └── wake-agent Edge Function → Fly Machines start API
  │
  └── Fly.io Machines (one per agent)
        ├── ttyd (browser terminal, port 7681)
        ├── tmux (session persistence)
        ├── runtime-entrypoint (generic; reads AGENT_KIND/AGENT_EXEC from image ENV)
        ├── message-handler (polls + executes messages, streams output)
        ├── Atlas MCP server (send_message / wait_for_reply / agent_lookup via stdio)
        └── agent binary (claude-agent or opencode-agent)

### Docker Image Hierarchy
```
atlas-base
  ├── ttyd + tmux + jq + Node.js
  ├── shared scripts (runtime-entrypoint, agent-register, message-handler,
  │   send-message, wait-for-reply, agent-lookup)
  └── Atlas MCP server (/usr/local/lib/atlas-mcp/)
        │
        ├── atlas-claude-agent
        │     ├── @anthropic-ai/claude-code
        │     ├── openrouter-proxy (translates model IDs → OpenRouter format)
        │     └── .claude.json with mcpServers.atlas wired to MCP server
        │
        └── atlas-opencode-agent
              ├── opencode-ai
              └── ~/.config/opencode/config.json with mcp.atlas wired to MCP server
```

### Agent Lifecycle
```
Provision → Register → Running → [idle] → Suspended
                                              ↑         ↓
                                         Message INSERT → wake-agent → Started
                                                                          ↓
                                                               message-handler picks up → executes → streams result
```

### Message Flow
```
User (UI) ──INSERT──→ messages table
                           │
                    DB trigger fires
                           │
                    wake-agent Edge Function
                           │
                    Fly Machines /start API
                           │
                    Machine wakes (~4s)
                           │
                    message-handler polls
                           │
                    executes payload
                           │
                    PATCHes result every 1s  ──→ Supabase Realtime ──→ UI updates live
                           │
                    status = done
```

---

## 6. Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TypeScript |
| API | Fastify (Node.js) |
| Database | Supabase (Postgres + Realtime + Edge Functions) |
| Local state | SQLite (agent/workspace records) |
| Agent runtime | Fly.io Machines + Fly Volumes |
| Terminal | ttyd + tmux |
| Models | Claude Code (claude-agent), OpenCode/Gemini (opencode-agent) — via OpenRouter |
| Deployment | Vercel (frontend), local server for now |

---

## 7. V1 Milestones

### ✅ Milestone 1 — Browser terminal on Fly Machine
Browser connects to ttyd running inside a Fly Machine. Proven.

### ✅ Milestone 2 — Suspend/resume preserves session
tmux session survives autostop. Machine restarts, session resumes. Proven.

### ✅ Milestone 3 — Claude Code executes inside runtime
claude-agent running Claude Code via OpenRouter proxy. Proven.

### ✅ Milestone 4 — Message queue + wake-on-demand
DB trigger wakes suspended machine on message INSERT. End-to-end in 4-8s. Proven.

### ✅ Milestone 5 — Streaming output
Agent streams partial output to UI every 1s while task runs. Proven.

### ✅ Milestone 6 — Multi-agent coordination
Agents can discover, message, and wait on each other. send-message / wait-for-reply / agent-lookup working. Proven.

### ✅ Milestone 7 — Production UI shell
React + Tailwind v4 + shadcn/ui. Dark sidebar with workspace-scoped agent list. Inline terminal iframe per agent, cached in DOM for instant tab switching. Modals for workspace/agent creation with provisioning progress state. Deployed to Vercel.

### ✅ Milestone 8 — Base image + Atlas MCP server
Consolidated shared runtime scripts and generic entrypoint into `atlas-base`. Atlas MCP server exposes `send_message`, `wait_for_reply`, `agent_lookup` via stdio — discovered automatically by Claude Code and OpenCode without prompt engineering. Agent Dockerfiles reduced to ~25 lines each.

### 🔜 Milestone 9 — GitHub webhook → agent trigger
GitHub webhook on PR/push inserts a message. Agent reviews code, posts comment. First external integration.

### 🔜 Milestone 10 — On-demand agent provisioning from coordinator
Coordinator provisions a new Fly Machine for a task, tears it down on completion. Elastic compute.

### 🔜 Milestone 11 — Production-grade deployment
Auth (Supabase Auth or Clerk), proper multi-user workspaces, server deployed to Fly instead of local.

---

## 8. Open Questions

1. **Task UI** — should tasks be a first-class entity (separate from messages), or is the message queue sufficient?
2. **Agent memory** — is `/data/memory.md` enough for V1, or do we need vector search?
3. **Server deployment** — Fastify API is currently localhost. Needs to move to Fly or Vercel for production.
4. **Cost controls** — OpenRouter usage API gives spend data but no hard budget enforcement yet. How do we gate?
5. **MCP server env** — SUPABASE_URL/ANON_KEY/AGENT_ID must be in the tmux session for Claude to inherit them when spawning the MCP server. Needs verification on first full image build.
