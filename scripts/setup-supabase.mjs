/**
 * Runs the Supabase schema migration against the live project.
 * Requires SUPABASE_DB_PASSWORD in .env.
 *
 * Usage: node scripts/setup-supabase.mjs
 */

import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

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

const env = { ...loadEnv(), ...process.env };
const PROJECT_REF = "nsqpzqyykpeqoyokwutb";
const DB_PASSWORD = env.SUPABASE_DB_PASSWORD;

if (!DB_PASSWORD) {
  console.error("SUPABASE_DB_PASSWORD not set in .env");
  process.exit(1);
}

// Use Supabase Management API to run SQL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;

// Try Management API with PAT if available, otherwise use direct pg connection
const PAT = env.SUPABASE_PAT;

const sql = readFileSync("supabase/migrations/20260524000000_agent_comms.sql", "utf8");

if (PAT) {
  console.log("Running schema via Management API...");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PAT}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: sql })
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("Management API error:", body);
    process.exit(1);
  }
  console.log("Schema applied via Management API.");
} else {
  // Direct postgres connection via supabase CLI
  console.log("Running schema via supabase CLI db push...");
  const { spawnSync } = await import("node:child_process");

  // Write the SQL to a temp migration if not already there
  const dbUrl = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(DB_PASSWORD)}@aws-0-us-east-2.pooler.supabase.com:6543/postgres`;

  const r = spawnSync(
    "supabase",
    ["db", "push", "--db-url", dbUrl],
    { stdio: "inherit", cwd: process.cwd() }
  );

  if (r.status !== 0) {
    console.error("supabase db push failed");
    process.exit(1);
  }
  console.log("Schema applied via supabase db push.");
}

// Verify tables exist by querying via REST
console.log("\nVerifying tables...");
const check = await fetch(
  `https://${PROJECT_REF}.supabase.co/rest/v1/agents?limit=1`,
  { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
);
if (check.ok) {
  console.log("✓ agents table exists");
} else {
  console.error("✗ agents table not found:", await check.text());
}

const check2 = await fetch(
  `https://${PROJECT_REF}.supabase.co/rest/v1/messages?limit=1`,
  { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
);
if (check2.ok) {
  console.log("✓ messages table exists");
} else {
  console.error("✗ messages table not found:", await check2.text());
}
