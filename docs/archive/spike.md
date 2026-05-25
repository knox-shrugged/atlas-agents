AtlasLives V1 — Product Outline & Technical Spike
AtlasLives is a cloud-native operational workspace for persistent autonomous AI coding agents. This document defines the V1 product scope, architecture, and an initial technical spike suitable for implementation by Codex or other coding agents.
1. Core Product Thesis
Persistent autonomous coding agents are more valuable than temporary AI chat sessions.
Users create workspaces containing multiple specialized AI agents.
Each agent runs in its own isolated persistent runtime.
Agents execute long-running coding tasks autonomously.
Humans supervise through operational dashboards and browser terminals.
2. V1 Product Scope
Workspace creation
Launch Claude Code, OpenCode, Codex, and Pi runtimes
Persistent terminal sessions
Task assignment and tracking
GitHub repository integration
Operational dashboard
Suspend/resume runtime lifecycle
Atlas Model Gateway for billing and provider management
3. V1 Non-Goals
Agent-to-agent orchestration
Shared filesystem
Complex workflow builders
Organization/team support
Autonomous PR merging
Memory graphs
Advanced MCP coordination
4. Core UX Model
Workspace is the top-level operational boundary.
Tasks are the primary unit of work.
Agents are execution resources attached to tasks.
Terminal access is for supervision, debugging, and intervention.
Operational dashboard is the primary UI.
5. Technical Architecture
Frontend: Next.js + React + Tailwind + xterm.js
Runtime Infrastructure: Fly.io Machines
Persistence: Fly Volumes + tmux
Database: PostgreSQL (Neon recommended)
Model Gateway: LiteLLM or Bifrost
GitHub as source of truth for code
One isolated Fly Machine per agent runtime
6. Atlas Model Gateway
Centralized provider access layer
Agents never receive raw provider API keys
Supports Anthropic, OpenAI, OpenRouter
Per-task and per-workspace budget enforcement
Usage ledger and cost attribution
Provider abstraction and routing
7. Initial Technical Spike (Codex Implementation Plan)
Goal: prove the core AtlasLives magic using the smallest possible implementation.
Create a Next.js application with a workspace dashboard.
Integrate Fly.io API for Machine lifecycle management.
Build a Docker image containing tmux, ttyd, bash, git, and Claude Code.
Launch one Fly Machine per agent runtime.
Expose ttyd via HTTPS/WebSocket.
Integrate xterm.js frontend terminal.
Implement machine suspend/resume behavior.
Reconnect to tmux sessions after restore.
Persist runtime state using Fly Volumes.
Add basic task creation UI and task status tracking.
8. Codex Bootstrap Prompt
Build an AtlasLives technical spike.Goal:Create a minimal Next.js app that can:1. Create a workspace2. Launch a Fly.io Machine for one agent runtime3. Show agent status4. Open a browser terminal using xterm.js5. Connect to a ttyd endpoint running inside the machine6. Suspend/resume the machine using Fly APIs7. Restore tmux sessions after reconnectDo not build:- billing UI- organization support- advanced orchestration- multi-agent coordination- approvals workflowsFocus entirely on proving:persistent Fly Machines + browser terminal continuity.Recommended stack:- Next.js- Tailwind- Fly.io Machines- tmux- ttyd- xterm.js- PostgreSQLArchitecture:- one Fly Machine per agent runtime- isolated filesystem per runtime- GitHub as source of truth- autosuspend/autostart behavior
9. Milestones
Milestone 1: Browser terminal successfully connects to Fly Machine
Milestone 2: Suspend/resume preserves tmux session
Milestone 3: Claude Code executes inside runtime
Milestone 4: Task assignment UI triggers autonomous work
Milestone 5: GitHub repo clone + branch creation works