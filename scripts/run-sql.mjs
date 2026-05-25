#!/usr/bin/env node
/**
 * Run SQL against the Supabase project via the Management API.
 * Reads SUPABASE_PAT from .env.
 *
 * Usage:
 *   node scripts/run-sql.mjs "select count(*) from messages"
 *   echo "select 1" | node scripts/run-sql.mjs
 */
import { readFileSync } from "node:fs";

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
const PAT = process.env.SUPABASE_PAT || env.SUPABASE_PAT;
const PROJECT_REF = "nsqpzqyykpeqoyokwutb";

if (!PAT) {
  console.error("SUPABASE_PAT not set");
  process.exit(1);
}

let query = process.argv[2];
if (!query) {
  // read from stdin
  query = readFileSync("/dev/stdin", "utf8").trim();
}

if (!query) {
  console.error("No query provided");
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${PAT}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ query })
});

const text = await res.text();
const data = text ? JSON.parse(text) : null;

if (!res.ok) {
  console.error("SQL error:", data?.message || text);
  process.exit(1);
}

console.log(JSON.stringify(data, null, 2));
