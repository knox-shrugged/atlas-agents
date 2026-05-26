import { config } from "./config.mjs";

const BASE = "https://backend.composio.dev/api/v3";

function headers() {
  return {
    "x-api-key": config.composioApiKey,
    "Content-Type": "application/json",
  };
}

export async function listAuthConfigs() {
  const res = await fetch(`${BASE}/auth_configs?limit=100`, { headers: headers() });
  if (!res.ok) return [];
  const json = await res.json();
  const seen = new Set();
  return (json.items || [])
    .map(ac => ({
      id: ac.id,
      name: ac.name,
      toolkit: ac.toolkit?.slug || extractToolkitSlug(ac.name),
      authScheme: ac.auth_scheme,
      isComposioManaged: ac.is_composio_managed,
    }))
    .filter(ac => {
      if (seen.has(ac.toolkit)) return false;
      seen.add(ac.toolkit);
      return true;
    });
}

export async function searchToolkits(query) {
  const qs = query ? `&search=${encodeURIComponent(query)}` : "";
  const res = await fetch(`${BASE}/toolkits?limit=24${qs}`, { headers: headers() });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.items || []).map(tk => ({
    slug: tk.slug,
    name: tk.name,
    logo: tk.meta?.logo ?? null,
    toolsCount: tk.meta?.tools_count ?? 0,
    description: tk.meta?.description ?? null,
    composioManaged: (tk.composio_managed_auth_schemes ?? []).length > 0,
  }));
}

export async function ensureAuthConfig(toolkitSlug) {
  const configs = await listAuthConfigs();
  const existing = configs.find(c => c.toolkit === toolkitSlug);
  if (existing) return existing.id;

  const res = await fetch(`${BASE}/auth_configs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ toolkit: { slug: toolkitSlug }, use_composio_managed_oauth: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create auth_config for ${toolkitSlug}: ${text}`);
  }
  const json = await res.json();
  return json.auth_config?.id;
}

export async function getConnectedAccounts(userId) {
  const res = await fetch(`${BASE}/connected_accounts?limit=200`, { headers: headers() });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.items || [])
    .filter(ca => ca.user_id === userId)
    .map(ca => ({
      id: ca.id,
      toolkit: ca.toolkit?.slug,
      authScheme: ca.authScheme,
      wordId: ca.word_id,
      status: ca.status,
    }));
}

export async function createConnectionLink(authConfigId, userId, redirectUrl) {
  const res = await fetch(`${BASE}/connected_accounts/link`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      auth_config_id: authConfigId,
      user_id: userId,
      redirect_url: redirectUrl,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio link failed ${res.status}: ${text}`);
  }
  return res.json();
}

export async function deleteConnectedAccount(connectionId) {
  const res = await fetch(`${BASE}/connected_accounts/${connectionId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio disconnect failed ${res.status}: ${text}`);
  }
  return true;
}

function extractToolkitSlug(name) {
  const m = name.match(/auth_config_([^_]+)/);
  return m ? m[1] : name;
}
