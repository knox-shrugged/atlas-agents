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
