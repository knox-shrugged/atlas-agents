/**
 * Push updated runtime bin/ scripts to a running Fly machine via SSH and
 * restart the agent's tmux session — skips Docker build/push entirely.
 *
 * Usage:
 *   node scripts/push-runtime.mjs <app-name> <agent-kind>
 *
 * Examples:
 *   node scripts/push-runtime.mjs atlas-agent-1a0f2baedf claude-agent
 *   node scripts/push-runtime.mjs atlas-agent-abc123 shell-agent
 *   node scripts/push-runtime.mjs atlas-agent-abc123 opencode-agent
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [, , appName, kind] = process.argv;

const VALID_KINDS = ["shell-agent", "opencode-agent", "claude-agent", "pi-agent", "codex-agent", "aider-agent", "goose-agent", "hermes-agent", "cursor-agent", "antigravity-agent", "copilot-agent"];

if (!appName || !kind || !VALID_KINDS.includes(kind)) {
  console.error(`Usage: node scripts/push-runtime.mjs <app-name> <agent-kind>`);
  console.error(`  agent-kind: ${VALID_KINDS.join(" | ")}`);
  process.exit(1);
}

// Collect scripts from base (shared) and the agent-specific dir, agent-specific wins on conflict
const baseBinDir = join("runtime", "base", "bin");
const kindBinDir = join("runtime", kind, "bin");

const FLY_API_TOKEN =
  process.env.FLY_API_TOKEN ||
  (() => {
    try {
      const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("FLY_API_TOKEN="));
      return line ? line.slice("FLY_API_TOKEN=".length).trim() : "";
    } catch { return ""; }
  })();

if (!FLY_API_TOKEN) {
  console.error("FLY_API_TOKEN not set");
  process.exit(1);
}

const FLYCTL = `${process.env.HOME}/.fly/bin/flyctl`;

function fly(args, opts = {}) {
  const r = spawnSync(FLYCTL, args, {
    stdio: opts.quiet ? "pipe" : "inherit",
    env: { ...process.env, FLY_API_TOKEN }
  });
  if (r.status !== 0 && !opts.allowFail) {
    process.exit(r.status ?? 1);
  }
  return r;
}

function ssh(cmd, opts = {}) {
  // Wrap in bash -c so semicolons, redirects, and subshells work correctly
  return fly(["ssh", "console", "-a", appName, "-C", `bash -c ${JSON.stringify(cmd)}`], opts);
}

// Merge base + kind-specific scripts; kind-specific wins on conflict
const files = new Map();
for (const dir of [baseBinDir, kindBinDir]) {
  try {
    for (const file of readdirSync(dir)) {
      files.set(file, join(dir, file));
    }
  } catch { /* dir may not exist */ }
}

console.log(`Pushing ${kind} scripts → ${appName}:/usr/local/bin/`);
for (const [file, filePath] of files) {
  const content = readFileSync(filePath);
  const b64 = content.toString("base64");
  console.log(`  → ${file}`);
  ssh(`echo '${b64}' | base64 -d > /usr/local/bin/${file} && chmod +x /usr/local/bin/${file}`);
}

const agentCmd = {
  "shell-agent": "atlas-agent start",
  "opencode-agent": "opencode-agent start",
  "claude-agent": "claude-agent start",
  "pi-agent": "pi-agent start",
  "codex-agent": "codex-agent start",
  "aider-agent": "aider-agent start",
  "goose-agent": "goose-agent start",
  "hermes-agent": "hermes-agent start",
  "cursor-agent": "cursor-agent start",
  "antigravity-agent": "antigravity-agent start",
  "copilot-agent": "copilot-agent start",
}[kind];

// Restart the tmux session (window 0: agent, window 1: message-handler)
console.log("Restarting tmux session...");
const envVars = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
  "ATLAS_GITHUB_REPO", "ATLAS_GITHUB_TOKEN",
  "ATLAS_GIT_USER_NAME", "ATLAS_GIT_USER_EMAIL",
  "OPENROUTER_API_KEY",
].map((k) => `-e ${k}="$(printenv ${k})"`)
  .join(" ");

const agentExec = kind === "claude-agent" ? "claude" : "bash";

ssh(
  // Kill and recreate window 0 with the agent command
  `tmux kill-session -t atlas-agent 2>/dev/null; ` +
  `tmux new-session -d -s atlas-agent ${envVars} '${agentCmd}'; ` +
  // Recreate window 1 (handler) if the agent was registered and Supabase is configured
  `AGENT_ID="$(cat /data/agent_id 2>/dev/null || true)"; ` +
  `SUPA_URL="$(printenv SUPABASE_URL 2>/dev/null || true)"; ` +
  `if [ -n "$AGENT_ID" ] && [ -n "$SUPA_URL" ]; then ` +
  `  tmux new-window -t atlas-agent -n handler ` +
  `    -e AGENT_ID="$AGENT_ID" ` +
  `    -e SUPABASE_URL="$SUPA_URL" ` +
  `    -e SUPABASE_ANON_KEY="$(printenv SUPABASE_ANON_KEY 2>/dev/null || true)" ` +
  `    -e AGENT_EXEC=${agentExec} ` +
  `    'while true; do message-handler; sleep 5; done'; ` +
  `  tmux select-window -t atlas-agent:0; ` +
  `fi`,
  { allowFail: true }
);

console.log(`\nDone. Terminal: https://${appName}.fly.dev`);
