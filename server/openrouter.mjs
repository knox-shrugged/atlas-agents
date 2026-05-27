import { config } from "./config.mjs";

const BASE = "https://openrouter.ai/api/v1";

function provisionerHeaders() {
  return {
    Authorization: `Bearer ${config.openrouterProvisionerKey}`,
    "Content-Type": "application/json",
  };
}

export async function createOpenRouterKey(label, limitUsd = 5) {
  const res = await fetch(`${BASE}/keys`, {
    method: "POST",
    headers: provisionerHeaders(),
    body: JSON.stringify({ name: label, limit: limitUsd }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter key creation failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  return { key: json.key, hash: json.data?.hash };
}

export async function getKeyUsage(hash) {
  if (!hash) return null;
  const res = await fetch(`${BASE}/keys/${hash}`, {
    headers: provisionerHeaders(),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const d = json.data ?? {};
  return {
    usage: d.usage ?? 0,
    limit: d.limit ?? null,
    limit_remaining: d.limit_remaining ?? null,
    is_free_tier: d.is_free_tier ?? false,
  };
}

// Per-model activity for a sub-key, aggregated across completed UTC days (1-day lag).
// Each item: { model, requests, prompt_tokens, completion_tokens, cost }
export async function getKeyActivity(hash) {
  if (!hash) return [];
  const res = await fetch(`${BASE}/activity?api_key_hash=${hash}`, {
    headers: provisionerHeaders(),
  });
  if (!res.ok) return [];
  const rows = (await res.json()).data ?? [];

  const byModel = {};
  for (const row of rows) {
    const key = row.model || "unknown";
    if (!byModel[key]) byModel[key] = { model: key, requests: 0, prompt_tokens: 0, completion_tokens: 0, cost: 0 };
    byModel[key].requests          += row.requests          ?? 0;
    byModel[key].prompt_tokens     += row.prompt_tokens     ?? 0;
    byModel[key].completion_tokens += row.completion_tokens ?? 0;
    byModel[key].cost              += row.usage             ?? 0;
  }
  return Object.values(byModel).sort((a, b) => b.cost - a.cost);
}

