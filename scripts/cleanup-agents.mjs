/**
 * DB-aware Fly machine cleanup.
 *
 * Lists all atlas-agent-* Fly apps, cross-references with workspace_agents in
 * Supabase, and destroys any that have no DB record (orphans from failed
 * provisions, old spikes, etc.).
 *
 * Usage:
 *   node scripts/cleanup-agents.mjs          # dry-run (shows what would be deleted)
 *   node scripts/cleanup-agents.mjs --yes    # actually destroy orphans
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ── load .env ─────────────────────────────────────────────────────────────────

const env = {};
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("Could not read .env — run from project root.");
  process.exit(1);
}

const FLY_API_TOKEN = env.FLY_API_TOKEN;
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!FLY_API_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing FLY_API_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const dryRun = !process.argv.includes("--yes");

// ── fetch all atlas-agent-* apps from Fly ────────────────────────────────────

async function flyGraphql(query, variables = {}) {
  const res = await fetch("https://api.fly.io/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${FLY_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

async function flyDelete(path) {
  const res = await fetch(`https://api.machines.dev/v1${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${FLY_API_TOKEN}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`DELETE ${path} failed ${res.status}: ${text}`);
  }
}

console.log("Fetching Fly apps…");
const data = await flyGraphql(`
  { organization(slug:"personal") {
      apps(first: 500) { nodes { name machines { nodes { id state } } } }
  } }
`);

const allApps = data.organization.apps.nodes;
const agentApps = allApps.filter((a) => a.name.startsWith("atlas-agent-"));
console.log(`Found ${agentApps.length} atlas-agent-* apps on Fly (${allApps.length} total).`);

// ── fetch known app names from Supabase ──────────────────────────────────────

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: dbAgents, error } = await db.from("workspace_agents").select("fly_app_name");
if (error) { console.error("Supabase error:", error.message); process.exit(1); }

const knownAppNames = new Set(dbAgents.map((a) => a.fly_app_name).filter(Boolean));
console.log(`Found ${knownAppNames.size} agents in workspace_agents DB.`);

// ── diff ──────────────────────────────────────────────────────────────────────

const orphans = agentApps.filter((a) => !knownAppNames.has(a.name));
const active = agentApps.filter((a) => knownAppNames.has(a.name));

console.log(`\nActive (in DB):   ${active.length}`);
console.log(`Orphaned (not in DB): ${orphans.length}`);

if (orphans.length === 0) {
  console.log("\nNothing to clean up.");
  process.exit(0);
}

console.log("\nOrphaned apps:");
for (const app of orphans) {
  const machines = app.machines?.nodes ?? [];
  const states = machines.map((m) => m.state).join(", ") || "no machines";
  console.log(`  ${app.name}  [${states}]`);
}

if (dryRun) {
  console.log("\nDry run — pass --yes to destroy these apps.");
  process.exit(0);
}

// ── destroy orphans ───────────────────────────────────────────────────────────

console.log("\nDestroying orphaned apps…");
let ok = 0, fail = 0;

for (const app of orphans) {
  process.stdout.write(`  ${app.name} … `);
  try {
    await flyDelete(`/apps/${app.name}`);
    console.log("deleted");
    ok++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    fail++;
  }
}

console.log(`\nDone. ${ok} deleted, ${fail} failed.`);
