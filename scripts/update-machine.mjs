/**
 * Update an existing Fly machine to use the latest image in place.
 * Avoids the full reprovision (no new app/volume/IPs) — just pulls
 * the new image and restarts the machine.
 *
 * Usage:
 *   node scripts/update-machine.mjs <app-name> [image]
 *
 * Examples:
 *   node scripts/update-machine.mjs atlas-agent-1a0f2baedf
 *   node scripts/update-machine.mjs atlas-agent-1a0f2baedf registry.fly.io/atlaslives-claude:latest
 */

import { readFileSync } from "node:fs";

const [, , appName, imageArg] = process.argv;

if (!appName) {
  console.error("Usage: node scripts/update-machine.mjs <app-name> [image]");
  process.exit(1);
}

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(".env", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
    );
  } catch { return {}; }
}

const env = loadEnv();
const FLY_API_TOKEN = process.env.FLY_API_TOKEN || env.FLY_API_TOKEN;
const FLY_API_HOSTNAME = process.env.FLY_API_HOSTNAME || "https://api.machines.dev";

if (!FLY_API_TOKEN) {
  console.error("FLY_API_TOKEN not set");
  process.exit(1);
}

async function flyRequest(path, { method = "GET", body } = {}) {
  const r = await fetch(`${FLY_API_HOSTNAME}/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${FLY_API_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Fly API ${method} ${path} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function detectImage(name) {
  if (name.includes("opencode")) return env.FLY_OPENCODE_RUNTIME_IMAGE;
  if (name.includes("claude")) return env.FLY_CLAUDE_RUNTIME_IMAGE;
  return env.FLY_RUNTIME_IMAGE;
}
const image = imageArg || detectImage(appName);

if (!image) {
  console.error("Could not determine image — pass it explicitly or check .env");
  process.exit(1);
}

console.log(`Fetching machines for ${appName}...`);
const machines = await flyRequest(`/apps/${appName}/machines`);
if (!machines?.length) {
  console.error("No machines found");
  process.exit(1);
}

const machine = machines[0];
console.log(`Updating machine ${machine.id} → ${image}`);

await flyRequest(`/apps/${appName}/machines/${machine.id}`, {
  method: "POST",
  body: { config: { ...machine.config, image } }
});

console.log("Waiting for machine to start...");
let attempts = 0;
while (attempts++ < 30) {
  await new Promise((r) => setTimeout(r, 2000));
  const m = await flyRequest(`/apps/${appName}/machines/${machine.id}`);
  process.stdout.write(`  state: ${m.state}\r`);
  if (m.state === "started") {
    console.log(`\nMachine started.`);
    break;
  }
}

console.log(`\nDone. Terminal: https://${appName}.fly.dev`);
