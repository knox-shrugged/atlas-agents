# Agent Compatibility Research

Compatibility notes for candidate agents to add to the AtlasLives platform.
Each entry covers: what it is, OpenRouter support, atlas-agents fit, and build effort.

---

## Deployed Agents

All agents currently live on the platform as of May 2026.

| Agent | Kind | Model / Backend | Auth | Notes |
|---|---|---|---|---|
| **opencode-agent** | `opencode-agent` | Gemini 2.5 Flash via OpenRouter | `OPENROUTER_API_KEY` | TypeScript TUI; upstream opencode-ai/opencode |
| **claude-agent** | `claude-agent` | Claude (Anthropic) via OpenRouter proxy | `OPENROUTER_API_KEY` + proxy | Local proxy rewrites model IDs; `ANTHROPIC_BASE_URL` points at it |
| **pi-agent** | `pi-agent` | pi.dev models via OpenRouter | `OPENROUTER_API_KEY` | Node-based TUI; pi.dev CLI |
| **codex-agent** | `codex-agent` | o4-mini via OpenRouter | `OPENROUTER_API_KEY` (as `OPENAI_API_KEY`) | OpenAI Codex CLI |
| **aider-agent** | `aider-agent` | Qwen2.5-Coder via OpenRouter | `OPENROUTER_API_KEY` | Python; git-native diff/patch workflow |
| **goose-agent** | `goose-agent` | Gemini 2.5 Flash via OpenRouter | `OPENROUTER_API_KEY` | Block's Rust-based agent; now Linux Foundation |
| **hermes-agent** | `hermes-agent` | Gemini 2.5 Flash via OpenRouter | `OPENROUTER_API_KEY` | Meta-agent/orchestrator; self-improving skills |
| **cursor-agent** | `cursor-agent` | Cursor backend / OpenRouter local mode | `OPENROUTER_API_KEY` | Cursor Agent CLI; closed source |
| **antigravity-agent** | `antigravity-agent` | Google Antigravity backend | Google OAuth | Token persisted to Fly volume; OAuth on first boot |
| **copilot-agent** | `copilot-agent` | Claude Sonnet 4.5 via GitHub backend | `GH_TOKEN` PAT | GitHub-native context (issues, PRs); Copilot subscription required |
| **gemini-agent** | `gemini-agent` | Gemini 2.5 Pro (Google) | Google OAuth | Token persisted to Fly volume; 1000 req/day free |
| **openhands-agent** | `openhands-agent` | claude-sonnet-4-5 via OpenRouter | `OPENROUTER_API_KEY` | Autonomous multi-step; no Docker sandbox on Fly |

---

## Hermes Agent

**Repo:** https://github.com/NousResearch/hermes-agent  
**Stars:** ~170k  
**Language:** Python  
**License:** MIT  
**Status:** ✅ Deployed as `hermes-agent`

### What it is
Self-improving Python agent with a learning loop — creates skills from experience, improves them during use, builds persistent memory across sessions. Has a TUI (`hermes --tui`), CLI chat, scheduled automations, and multi-platform messaging gateways (Telegram, Slack, Discord, WhatsApp). Available on PyPI as `hermes-agent` (v0.14+).

#### Coding capability — two layers

**Layer 1: Direct coding tools.** Hermes has built-in tools for software development: `terminal` (shell execution), `read_file`/`patch` (file editing), `execute_code` (sandboxed Python RPC that collapses multi-step workflows into a single LLM turn), and `delegate_task` (spawn isolated subagents in parallel). Docker backend provides a persistent sandbox VM. Covers the same ground as aider for everyday coding tasks.

**Layer 2: Orchestrates other coding agents.** The `skills/autonomous-ai-agents/` directory contains built-in skills for delegating to Claude Code, Codex, and OpenCode — the same OpenCode we run as `opencode-agent` on atlas. Hermes routes tasks to whichever agent is best suited (e.g. `claude -p "task"` in print mode for one-shot git/refactor work). The `skills/software-development/` tree covers TDD, systematic debugging, plan-driven development, subagent-driven development, and code review as structured workflows.

This makes hermes a **meta-agent / orchestrator** rather than a pure coding tool. On atlas-agents, a hermes machine could theoretically delegate to a co-located opencode-agent or claude-agent. It is positioned differently from aider (direct file editor) or OpenHands (autonomous executor) — it coordinates, routes, and learns rather than competing head-on with specialized coding agents.

### OpenRouter support
Native. `OPENROUTER_API_KEY` is the primary env var. Model switchable via `hermes model` or `config.yaml`. No proxy or translation layer needed.

### Verdict
**Built.** Best OpenRouter fit of all candidates, most features, active project.

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
**No.** Kiro routes exclusively through its own proprietary backend. No `ANTHROPIC_BASE_URL` override, no bring-your-own-key, no custom endpoints.

### Verdict
**Skip.** Hard auth dependency with no API key path. Check back if Kiro adds bring-your-own-key support.

---

## GitHub Copilot CLI

**Repo:** https://github.com/github/copilot-cli  
**Stars:** ~10.6k  
**Language:** TypeScript (closed source binary)  
**npm:** `@github/copilot` (293 MB)  
**Status:** ✅ Deployed as `copilot-agent`

### What it is
GitHub's terminal coding agent. TUI with plan mode and autopilot mode (Shift+Tab). Powered by Claude Sonnet 4.5 by default. Deeply GitHub-integrated — can access issues, PRs, and repos by natural language. Ships with GitHub's MCP server. LSP support for code intelligence.

### OpenRouter support
**Yes, via BYOK.** `COPILOT_PROVIDER_TYPE=openai`, `COPILOT_PROVIDER_BASE_URL=https://openrouter.ai/api/v1`, `COPILOT_PROVIDER_API_KEY=<key>`.

**Note:** In practice we use `GH_TOKEN` PAT auth against GitHub's Copilot backend rather than OpenRouter, so Copilot subscription billing applies.

### Verdict
**Built.** Auth is clean via PAT, GitHub integration is a genuine differentiator.

---

## Gemini CLI

**Repo:** https://github.com/google-gemini/gemini-cli  
**Stars:** ~104k  
**Language:** TypeScript  
**License:** Apache 2.0  
**npm:** `@google/gemini-cli`  
**Status:** ✅ Deployed as `gemini-agent`

### What it is
Google's open-source terminal agent. TUI with plan mode and autopilot mode. Access to Gemini 2.5 Pro models (1M token context window). Built-in tools: Google Search grounding, file operations, shell commands, web fetching. MCP support.

### OpenRouter support
**No.** Uses `@google/genai` SDK (Gemini API wire format). OpenRouter speaks OpenAI format only. Auth via Google OAuth (free: 1000 req/day) or `GEMINI_API_KEY`.

### Verdict
**Built** using Google OAuth. Token persists to Fly volume across suspend/resume. 1M context window is a differentiator.

---

## OpenHands CLI

**Repo:** https://github.com/all-hands-ai/openhands (main) / https://github.com/OpenHands/OpenHands-CLI (CLI)  
**Stars:** ~75k (main repo)  
**Language:** Python (SDK + CLI)  
**License:** MIT (CLI), Source-available (enterprise features)  
**Status:** ✅ Deployed as `openhands-agent`

### What it is
Autonomous coding agent platform — the most agentic of all candidates. SWE-bench score: 77.6%. Designed to plan and execute entire engineering tasks with minimal user intervention.

### OpenRouter support
**Yes.** `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` env vars with `--override-with-envs` flag. Note: `TTY_INTERACTIVE=1 TTY_COMPATIBLE=1` required to override Rich's terminal detection in tmux.

### Sandboxing note
Without Docker (Fly Machines), code runs directly on the machine — same as aider, goose, etc. Acceptable for spike.

### Verdict
**Built.** Unique autonomous character. Uses `uv tool install openhands --python 3.12` baked into image.

---

## Hermes Alternatives — Persistent General-Purpose Agents

These agents occupy the same general-purpose "always-on assistant" space as Hermes. All are primarily messaging-gateway agents — accessed via Telegram/WhatsApp/Discord rather than a browser terminal.

---

### ZeroClaw

**Repo:** https://github.com/zeroclaw-labs/zeroclaw  
**Stars:** ~31.6k | **Language:** Rust

Single Rust binary. Talks to ~20 LLM providers (OpenRouter confirmed), 30+ messaging channels. **Atlas fit:** No interactive TUI. **Skip.**

---

### PicoClaw

**Repo:** https://github.com/sipeed/picoclaw  
**Stars:** ~29k | **Language:** Go

Ultra-lightweight Go binary (<10MB RAM). Strong WeChat support; Chinese market positioning. **Atlas fit:** No browser TUI. **Skip.**

---

### nanobot

**Repo:** https://github.com/HKUDS/nanobot  
**Stars:** ~43k | **Language:** Python

OpenRouter confirmed. Has a terminal bot mode. Primarily messaging agent not a coding TUI. **Atlas fit:** Low-priority; revisit if a messaging agent is wanted.

---

### memU

**Repo:** https://github.com/NevaMind-AI/memU  
**Stars:** ~13.7k | **Language:** Python

Not a standalone agent — a **memory SDK** for other agents. **Atlas fit:** Not deployable standalone. **Skip.**

---

### TrustClaw

**Repo:** https://github.com/ComposioHQ/trustclaw  
**Stars:** ~715 | **Language:** TypeScript

Security-focused OpenClaw rebuild via Composio OAuth. Tiny community, early-stage. **Atlas fit:** Same gateway pattern. **Skip.**

---

## Antigravity CLI

**Repo:** https://github.com/google-antigravity/antigravity-cli  
**Stars:** ~694 (created May 2026)  
**Language:** Unknown (closed source binary)  
**License:** Proprietary (Google ToS)  
**Status:** ✅ Deployed as `antigravity-agent` (built despite Skip verdict)

### What it is
Google's terminal coding agent — a TUI companion to "Antigravity 2.0". Optimized for SSH/remote workflows. Explicitly designed for remote/SSH sessions.

### OpenRouter support
**No.** Google Sign-In only. No API key path.

### Auth model
Google OAuth. In container environments, token stored at `~/.gemini/antigravity-cli/` (file-based fallback). We symlink to `/data/.gemini` so token persists across suspend/resume.

### Known issues
Active Linux session persistence bug (re-login required on reboot in some desktop environments). On Fly Machines with file-based token storage this is resolved.

### Verdict
**Built** (despite Skip verdict) — the container file-based token storage workaround makes it viable. Token persists to Fly volume.

---

## Crush

**Repo:** https://github.com/charmbracelet/crush  
**Stars:** ~TBD (active May 2026)  
**Language:** Go  
**License:** MIT  
**npm:** `@charmland/crush`

### What it is
Terminal coding agent from Charm (makers of Bubble Tea, Lip Gloss, Glow). Built in Go with a Bubble Tea TUI. Multi-model support with mid-session model switching. LSP integration for code intelligence across 20+ languages. MCP support via stdio, HTTP, and SSE. Single Go binary under 10MB. Ships with project-local and global JSON config (`~/.config/crush/crush.json`).

Key differentiator: Charm's tooling quality bar is exceptionally high — the TUI is polished far beyond most coding agents. The Charm ecosystem (used in 25k+ apps) ensures the Bubble Tea framework is battle-tested.

### OpenRouter support
**Yes, confirmed.** Set via config file or env var:

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "<OPENROUTER_API_KEY>",
      "baseURL": "https://openrouter.ai/api/v1"
    }
  }
}
```

There is a dedicated community quickstart guide for Crush + OpenRouter. Known issue: setting only the OpenRouter API key on first run may not initialize the project correctly (GitHub issue #499) — config file approach is more reliable.

### Atlas-agents fit
**Excellent.** Key points:
- `npm install -g @charmland/crush` — base image already has Node 22
- OpenRouter confirmed working via config file
- Single Go binary, Bubble Tea TUI works with ttyd
- `~/.config/crush/` → symlink to Fly volume for persistence
- `OPENROUTER_API_KEY` as Fly secret

### Build effort
Low. Same pattern as cursor-agent and pi-agent (Node-based install, single binary, one secret). Bake `~/.config/crush/crush.json` with OpenRouter config into the image.

### Verdict
**Build it.** Clean fit, polished TUI, confirmed OpenRouter support, low effort.

---

## DeepSeek-TUI / CodeWhale

**Repo:** https://github.com/Hmbown/DeepSeek-TUI (may redirect to CodeWhale)  
**Stars:** ~2.3k (early May 2026, trending)  
**Language:** Rust (binary distributed via npm)  
**npm:** `deepseek-tui` (being rebranded to `codewhale`)

### What it is
Terminal coding agent built around DeepSeek V4's 1M-token context window. Written in Rust, distributed via npm as a binary downloader (no Rust toolchain needed at runtime). Three modes: Plan mode (review before executing), Agent mode (interactive with approval on sensitive actions), YOLO mode (fully autonomous). Can read/edit files, run shell commands, search the web, manage git, connect to MCP servers, and spawn parallel sub-agents.

Key differentiator: DeepSeek V4 pricing is roughly 1/10th of Claude Opus per task, making it the cheapest capable model on OpenRouter. The 1M token context window is genuinely useful for large codebases.

### OpenRouter support
**Yes.** Switch provider via `/provider openrouter` in-session and `/model <id>` to select the model. Auth via `DEEPSEEK_API_KEY` env var or `~/.deepseek/config.toml`. OpenRouter key can be set as the API key.

### Atlas-agents fit
**Good, with a rebranding caveat.** Key points:
- `npm install -g deepseek-tui` — base image already has Node 22
- Binary downloaded by npm installer — no Rust toolchain needed
- Auth via `DEEPSEEK_API_KEY` env var (set to OpenRouter key for OpenRouter models)
- Config at `~/.deepseek/config.toml` → symlink to Fly volume

**Rebranding risk (as of May 2026):** The project is mid-rename from `DeepSeek-TUI` to `CodeWhale`. The npm package `deepseek-tui` is being deprecated in favor of `codewhale`, with `deepseek` CLI aliases kept as shims. Building against `deepseek-tui` now may require an npm package name update in the near future. Watch https://github.com/Hmbown/DeepSeek-TUI/releases for the final rename.

### Build effort
Low-medium. Same pattern as other npm-installed binary agents. Main risk is the ongoing rebrand making the install path unstable. Recommend waiting until the `codewhale` package stabilizes (or building against a pinned version).

### Verdict
**Build it — but pin the version.** Strong cost/context differentiator via DeepSeek V4. Wait for the CodeWhale rename to settle or pin `deepseek-tui@<version>` in the Dockerfile to avoid breakage.

---

## Summary Table

### Candidates (research entries above)

| Agent | Stars | OpenRouter | Auth model | Atlas fit | Effort | Verdict |
|---|---|---|---|---|---|---|
| **Hermes** | 170k | ✅ Native | `OPENROUTER_API_KEY` | Excellent | Low | ✅ **Built** |
| **OpenClaw** | 375k | ❓ Unknown | Direct provider SDKs | Poor (gateway, not TUI) | High | **Skip** |
| **Kiro CLI** | — | ❌ No | Browser OAuth only | Poor | High | **Skip** |
| **GitHub Copilot CLI** | 10.6k | ✅ BYOK | `GH_TOKEN` PAT | Good | Low-med | ✅ **Built** |
| **Gemini CLI** | 104k | ❌ Wrong format | Google OAuth (free tier) | Good | Low | ✅ **Built** |
| **OpenHands CLI** | 75k | ✅ Native | `OPENROUTER_API_KEY` | Good | Low-med | ✅ **Built** |
| **ZeroClaw** | 31.6k | ✅ ~20 providers | Config file | Poor (gateway) | High | **Skip** |
| **PicoClaw** | 29k | ✅ Multiple | Config file | Poor (gateway) | High | **Skip** |
| **nanobot** | 43k | ✅ Confirmed | Config file | Low priority | Medium | **Maybe** |
| **memU** | 13.7k | N/A | N/A | Not standalone | N/A | **Skip** |
| **TrustClaw** | 715 | ✅ Via Composio | OAuth | Poor (gateway) | High | **Skip** |
| **Antigravity CLI** | 694 | ❌ No | Google OAuth | Poor (per doc) / Works in practice | High | ✅ **Built** |
| **Crush** | — | ✅ Confirmed | `OPENROUTER_API_KEY` via config | Excellent | Low | **Build** |
| **DeepSeek-TUI / CodeWhale** | ~2.3k | ✅ Yes | `DEEPSEEK_API_KEY` (use OR key) | Good | Low-med | **Build (pin version)** |
