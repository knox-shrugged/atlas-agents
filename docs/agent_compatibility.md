# Agent Compatibility Research

Compatibility notes for candidate agents to add to the AtlasLives platform.
Each entry covers: what it is, OpenRouter support, atlas-agents fit, and build effort.

Existing agents for reference: `shell-agent`, `opencode-agent`, `claude-agent`, `pi-agent`, `codex-agent`, `aider-agent`, `goose-agent`.

---

## Hermes Agent

**Repo:** https://github.com/NousResearch/hermes-agent  
**Stars:** ~170k  
**Language:** Python  
**License:** MIT

### What it is
Self-improving Python agent with a learning loop — creates skills from experience, improves them during use, builds persistent memory across sessions. Has a TUI (`hermes --tui`), CLI chat, scheduled automations, and multi-platform messaging gateways (Telegram, Slack, Discord, WhatsApp). Available on PyPI as `hermes-agent` (v0.14+).

#### Coding capability — two layers

**Layer 1: Direct coding tools.** Hermes has built-in tools for software development: `terminal` (shell execution), `read_file`/`patch` (file editing), `execute_code` (sandboxed Python RPC that collapses multi-step workflows into a single LLM turn), and `delegate_task` (spawn isolated subagents in parallel). Docker backend provides a persistent sandbox VM. Covers the same ground as aider for everyday coding tasks.

**Layer 2: Orchestrates other coding agents.** The `skills/autonomous-ai-agents/` directory contains built-in skills for delegating to Claude Code, Codex, and OpenCode — the same OpenCode we run as `opencode-agent` on atlas. Hermes routes tasks to whichever agent is best suited (e.g. `claude -p "task"` in print mode for one-shot git/refactor work). The `skills/software-development/` tree covers TDD, systematic debugging, plan-driven development, subagent-driven development, and code review as structured workflows.

This makes hermes a **meta-agent / orchestrator** rather than a pure coding tool. On atlas-agents, a hermes machine could theoretically delegate to a co-located opencode-agent or claude-agent. It is positioned differently from aider (direct file editor) or OpenHands (autonomous executor) — it coordinates, routes, and learns rather than competing head-on with specialized coding agents.

### OpenRouter support
Native. `OPENROUTER_API_KEY` is the primary env var. Model switchable via `hermes model` or `config.yaml`. No proxy or translation layer needed.

### Atlas-agents fit
**Excellent.** Follows the same pattern as every other agent:
- `pip install hermes-agent` in the Dockerfile (Python + uv needed)
- `HERMES_HOME=/data` points persistent data to the Fly volume
- Run `hermes --tui` inside tmux → ttyd wraps it as usual
- `OPENROUTER_API_KEY` as Fly secret

The upstream Dockerfile uses s6-overlay for multi-service supervision, but that's only needed for the production gateway setup. The CLI runs fine standalone — no s6 required.

**Bonus:** Built-in Telegram/Slack gateway means a hermes-agent machine could be configured as a persistent messaging bot — something no other atlas agent currently supports.

### Build effort
Low. Same pattern as aider-agent. Add Python 3.11+ + uv to a new `runtime/hermes-agent/` Dockerfile, write a startup script, wire up `provisionHermesAgent()` in `fly-client.mjs`.

### Verdict
**Build it.** Best OpenRouter fit of all candidates, most features, active project.

---

## OpenClaw

**Repo:** https://github.com/openclaw/openclaw  
**Stars:** ~375k  
**Language:** TypeScript  
**License:** MIT

### What it is
A persistent multi-channel AI gateway server. Primary mode is `openclaw gateway` — an HTTP server (port 3000) that connects AI to Telegram, WhatsApp, Discord, Slack, Signal, and iMessage. Users interact by messaging the bot from their phone, not via a browser terminal. Has its own web admin UI and already ships with a `fly.toml` designed for Fly App deployment.

Despite sharing the `@earendil-works/pi-tui` package with `pi-agent`, OpenClaw is a distinct product with its own source, gateway architecture, and feature set.

### OpenRouter support
Unknown / untested. Uses direct provider SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`, `@mistralai/mistralai`). No confirmed `OPENROUTER_API_KEY` support.

### Atlas-agents fit
**Poor fit for the current ttyd/browser-terminal pattern.** OpenClaw's UX is fundamentally a background server you message via phone — there's no meaningful TUI to put in a browser window.

Three paths exist but none map cleanly to the current platform:
- **Path A (Fly App):** Deploy using their native `fly.toml` as a Fly App (not Machine). Users configure via web UI, then message it via Telegram/WhatsApp. Requires a new "gateway app" provisioning type in atlas-agents.
- **Path B (CLI-only):** `npm install -g openclaw` + run `openclaw chat` in ttyd. Loses all gateway/messaging features.
- **Path C (Gateway + terminal):** Run openclaw gateway as a background service + ttyd sidecar. Complex, requires multi-port provisioning.

### Build effort
High, and requires platform changes (Fly App vs. Machine, new provisioning type, multi-port exposure).

### Verdict
**Skip for now.** Would require significant platform work and doesn't add a coding-agent capability. Revisit if atlas-agents adds a "persistent service" provisioning type alongside browser-terminal agents.

---

## Kiro CLI (formerly Amazon Q Developer CLI)

**Site:** https://kiro.dev/cli/  
**Repo:** https://github.com/kirodotdev/Kiro (closed source, issue tracker only)  
**Stars:** ~3.7k (issue tracker)  
**Language:** TypeScript (closed source)

### What it is
AWS's terminal coding agent. Amazon Q Developer CLI was deprecated and replaced by Kiro CLI. Has a TUI with plan mode and autopilot mode (Shift+Tab to cycle). Uses Claude frontier models routed through Kiro's proprietary backend. Free tier available; no AWS account required — login via GitHub, Google, or AWS Builder ID.

### OpenRouter support
**No.** Kiro routes exclusively through its own proprietary backend. No `ANTHROPIC_BASE_URL` override, no bring-your-own-key, no custom endpoints. The issue tracker has open requests asking for an API endpoint, suggesting none exists yet.

### Atlas-agents fit
**Poor.** Two blockers:
1. No OpenRouter / no API key — requires Kiro account via browser OAuth.
2. Closed source — can't patch or inspect it.

Auth requires a browser login flow (OAuth), same problem claude-agent solved by baking `~/.claude.json` into the image. That workaround is fragile and account-specific.

### Build effort
High friction with uncertain outcome due to closed-source auth flow.

### Verdict
**Skip.** Hard auth dependency with no API key path. Check back if Kiro adds bring-your-own-key support.

---

## GitHub Copilot CLI

**Repo:** https://github.com/github/copilot-cli  
**Stars:** ~10.6k  
**Language:** TypeScript (closed source binary)  
**npm:** `@github/copilot` (293 MB)

### What it is
GitHub's terminal coding agent. TUI with plan mode and autopilot mode (Shift+Tab). Powered by Claude Sonnet 4.5 by default, with GPT-5 and others available via `/model`. Deeply GitHub-integrated — can access issues, PRs, and repos by natural language. Ships with GitHub's MCP server. LSP support for code intelligence.

### OpenRouter support
**Yes, via BYOK (Bring Your Own Key/Model).** Already shipped and working. Set these env vars:

```bash
export COPILOT_PROVIDER_TYPE=openai
export COPILOT_PROVIDER_BASE_URL=https://openrouter.ai/api/v1
export COPILOT_PROVIDER_API_KEY=<OPENROUTER_API_KEY>
export COPILOT_MODEL=anthropic/claude-sonnet-4-5
```

OpenRouter's OpenAI-compatible endpoint works as a BYOK provider. Tested by users with Ollama Cloud and Azure OpenAI (same pattern).

**Note:** It is unclear whether a GitHub Copilot subscription is still required when using BYOK mode. May require at minimum a free GitHub Copilot tier (available on GitHub Free, no credit card needed).

### Atlas-agents fit
**Good.** Key points:
- PAT auth via `GH_TOKEN` or `GITHUB_TOKEN` env var — no browser OAuth required at runtime.
- `npm install -g @github/copilot` — base image already has Node 22.
- TUI works with ttyd.
- `OPENROUTER_API_KEY` as Fly secret (via `COPILOT_PROVIDER_API_KEY`).
- `GH_TOKEN` (PAT with "Copilot Requests" permission) as second Fly secret — separate from `ATLAS_GITHUB_TOKEN`.

**Unique upside:** Native GitHub context (issues, PRs, repos) is a genuine differentiator no other atlas agent provides.

### Build effort
Low-medium. Same Dockerfile pattern as pi-agent (Node-based, npm install). Startup script sets `COPILOT_PROVIDER_*` env vars and runs `copilot`. Two secrets required instead of one.

### Verdict
**Worth building.** OpenRouter works, auth is clean, GitHub integration is a real differentiator.

---

## Gemini CLI

**Repo:** https://github.com/google-gemini/gemini-cli  
**Stars:** ~104k  
**Language:** TypeScript  
**License:** Apache 2.0  
**npm:** `@google/gemini-cli`

### What it is
Google's open-source terminal agent. TUI with plan mode and autopilot mode. Access to Gemini 3 models (1M token context window). Built-in tools: Google Search grounding, file operations, shell commands, web fetching. MCP support.

### OpenRouter support
**No.** Gemini CLI uses `@google/genai` SDK which speaks the Gemini API wire format (`/v1beta/models/...`). OpenRouter only exposes an OpenAI-compatible endpoint. `GOOGLE_GEMINI_BASE_URL` lets you override the endpoint, but the target must speak Gemini API format — OpenRouter does not.

A LiteLLM proxy could bridge the gap in theory (translate Gemini format → OpenAI format → OpenRouter), but that's unnecessary complexity.

### Native key auth
`GEMINI_API_KEY` from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Free tier: 1,000 req/day with Gemini 3 Flash/Pro. No credit card, no Google Cloud project required. Can be set as a Fly secret instead of `OPENROUTER_API_KEY`.

### Atlas-agents fit
**Good, with a different billing model.** Uses `GEMINI_API_KEY` instead of `OPENROUTER_API_KEY`, but the pattern is identical — one API key as a Fly secret. `npm install -g @google/gemini-cli`, run `gemini` in tmux. No Docker required.

### Build effort
Low. Essentially the same as opencode-agent (Node-based TUI, one API key). Requires a separate onboarding step for users to get a Google AI Studio key.

### Verdict
**Worth building.** Clean fit, generous free tier, 1M context window is a differentiator. Different ecosystem (Google vs. Anthropic/OpenRouter) broadens the lineup.

---

## OpenHands CLI

**Repo:** https://github.com/all-hands-ai/openhands (main) / https://github.com/OpenHands/OpenHands-CLI (CLI)  
**Stars:** ~75k (main repo)  
**Language:** Python (SDK + CLI)  
**License:** MIT (CLI), Source-available (enterprise features)

### What it is
Autonomous coding agent platform — the most agentic of all candidates. SWE-bench score: 77.6%. Designed to plan and execute entire engineering tasks with minimal user intervention, not just assist interactively.

Two distinct products:
- **OpenHands (main repo):** Web GUI + agent server. Requires Docker socket (`/var/run/docker.sock`) for sandboxed code execution. **Not suitable for Fly Machines.**
- **OpenHands CLI:** Lightweight standalone binary. TUI built with `textual` (Python). Can run on local machine without Docker. This is the atlas-agents candidate.

### OpenRouter support
**Yes.** Three env vars:

```bash
export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_API_KEY=$OPENROUTER_API_KEY
export LLM_MODEL=anthropic/claude-sonnet-4-5
```

### Atlas-agents fit
**Good, with a sandboxing caveat.** The CLI runs code in the local process when Docker is unavailable — same as every other agent on the platform. The web GUI version (which requires Docker-in-Docker) does not fit.

Install: `uv tool install openhands --python 3.12` (requires Python 3.12 specifically — needs adding to Dockerfile).  
Config: `~/.openhands/` → redirect to `/data/.openhands`.  
TUI: `textual`-based, works with ttyd.

**Sandboxing note:** When Docker is present, OpenHands sandboxes code execution in throwaway containers. Without Docker (Fly Machines), code runs directly on the machine — same as aider, goose, etc. The isolation story is weaker than OpenHands's intended production setup, which is acceptable for this spike.

**Unique value:** Genuinely more autonomous than other agents. Hand it a multi-step task and it plans and executes without constant confirmation. Different character from interactive assistants like aider or pi.

### Build effort
Low-medium. Python 3.12 required (add to Dockerfile). `uv` install, three env vars, standard startup script. Same pattern as hermes-agent.

### Verdict
**Worth building.** Clean OpenRouter fit, unique autonomous character differentiates it from the rest of the lineup.

---

## Hermes Alternatives — Persistent General-Purpose Agents

These agents occupy the same general-purpose "always-on assistant" space as Hermes. They split into two families: the **"Claw" family** (OpenClaw derivatives/competitors) and the **"bot" family**. All are primarily messaging-gateway agents — accessed via Telegram/WhatsApp/Discord rather than a browser terminal — which puts them in the same category as OpenClaw for atlas-agents purposes.

**Hermes is differentiated** from all of them by having an interactive TUI (`hermes --tui`), a self-improving skills system, and the meta-agent delegation layer. The others are "always-on assistant you message" vs hermes being "agent you actively work with in a terminal."

---

### ZeroClaw

**Repo:** https://github.com/zeroclaw-labs/zeroclaw  
**Stars:** ~31.6k  
**Language:** Rust  
**License:** MIT / Apache 2.0

Single Rust binary (~3.4MB). Talks to ~20 LLM providers (Anthropic, OpenAI, Ollama, and others — OpenRouter confirmed), reaches 30+ messaging channels (Discord, Telegram, Matrix, email, voice, webhooks, CLI), and acts through tools (shell, browser, HTTP, hardware, custom MCP servers). Philosophy: "you own the agent, you own the data, you own the machine."

**Atlas fit:** Same gateway/messaging pattern as OpenClaw. Has a CLI channel but no interactive TUI designed for browser terminal use. **Skip** under the current architecture; revisit if a Fly App provisioning path is added.

---

### PicoClaw

**Repo:** https://github.com/sipeed/picoclaw  
**Stars:** ~29k  
**Language:** Go  
**License:** MIT

Ultra-lightweight Go binary: <10MB RAM, boots in milliseconds, runs on $10 RISC-V hardware. Built by Sipeed (Chinese hardware company) via a self-bootstrapping process (the agent itself drove the migration from Python). Supports x86_64, ARM64, MIPS, RISC-V, LoongArch. Strong WeChat support — positioned for the Chinese market.

**Notable:** Not a fork of OpenClaw or nanobot — built from scratch in Go. Most resource-efficient agent in the space.

**Atlas fit:** Same gateway/messaging pattern. No browser TUI. **Skip** unless targeting embedded/edge deployments.

---

### nanobot

**Repo:** https://github.com/HKUDS/nanobot  
**Stars:** ~43k  
**Language:** Python  
**License:** MIT

Lightweight Python agent from Hong Kong University of Data Science. Multi-platform messaging (Telegram, Discord, WhatsApp, WeChat, Matrix, Feishu), terminal bot mode, interactive setup wizard. OpenRouter confirmed in changelog (Claude caching fix shipped March 2026). Python 3.11+, installed via PyPI (`nanobot-ai`).

**Atlas fit:** Python + OpenRouter + terminal bot mode makes this the most atlas-agents-compatible of the hermes alternatives — but it's still primarily a messaging agent, not a coding TUI. Could potentially work in a ttyd terminal via the terminal bot mode. **Low-priority build candidate** if a simple persistent messaging agent is wanted alongside the coding agents.

---

### memU

**Repo:** https://github.com/NevaMind-AI/memU  
**Stars:** ~13.7k  
**Language:** Python  
**License:** MIT

Not a standalone agent — a **memory SDK** designed to plug into other agents (OpenClaw, nanobot, etc.). Provides structured, queryable persistent memory with filesystem-style organization and deduplication. Described as "Memory for 24/7 proactive agents."

**Atlas fit:** Not deployable standalone. Relevant if building a custom agent that needs advanced memory; hermes has its own memory system built in.

---

### TrustClaw

**Repo:** https://github.com/ComposioHQ/trustclaw  
**Stars:** ~715  
**Language:** TypeScript  
**License:** MIT

Security-focused rebuild of the OpenClaw pattern. Uses OAuth-only auth and isolated cloud environments (via Composio) to eliminate the credential exposure risk described in atlas-agents' security risks table. Access to 20,000+ managed tools via Composio. Small community; early-stage.

**Atlas fit:** Poor — same gateway pattern, tiny community. The Composio integration approach is interesting for the `COMPOSIO_API_KEY` security concern documented in CLAUDE.md (moving Composio server off the Fly machine), but TrustClaw itself isn't the solution to that.

---

## Summary Table

| Agent | Stars | OpenRouter | Auth model | Atlas fit | Effort | Verdict |
|---|---|---|---|---|---|---|
| **Hermes** | 170k | ✅ Native | `OPENROUTER_API_KEY` | Excellent | Low | **Build** |
| **OpenClaw** | 375k | ❓ Unknown | Direct provider SDKs | Poor (gateway, not TUI) | High | **Skip** |
| **Kiro CLI** | — | ❌ No | Browser OAuth only | Poor | High | **Skip** |
| **GitHub Copilot CLI** | 10.6k | ✅ BYOK | `GH_TOKEN` PAT + `OPENROUTER_API_KEY` | Good | Low-med | **Build** |
| **Gemini CLI** | 104k | ❌ Wrong format | `GEMINI_API_KEY` (free tier) | Good | Low | **Build** |
| **OpenHands CLI** | 75k | ✅ Native | `OPENROUTER_API_KEY` | Good | Low-med | **Build** |
| **ZeroClaw** | 31.6k | ✅ ~20 providers | Config file | Poor (gateway) | High | **Skip** |
| **PicoClaw** | 29k | ✅ Multiple | Config file | Poor (gateway) | High | **Skip** |
| **nanobot** | 43k | ✅ Confirmed | Config file | Low priority | Medium | **Maybe** |
| **memU** | 13.7k | N/A | N/A | Not standalone | N/A | **Skip** |
| **TrustClaw** | 715 | ✅ Via Composio | OAuth | Poor (gateway) | High | **Skip** |
