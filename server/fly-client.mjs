import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";

export class FlyClientError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "FlyClientError";
    this.details = details;
  }
}

function requireFlyConfig(image) {
  if (!config.flyApiToken) {
    throw new FlyClientError("FLY_API_TOKEN is not configured.");
  }
  if (!image) {
    throw new FlyClientError("Runtime image is not configured. Build and publish the runtime image first, then set the env var.");
  }
}

async function flyRequest(path, { method = "GET", body } = {}) {
  if (!config.flyApiToken) {
    throw new FlyClientError("FLY_API_TOKEN is not configured.");
  }

  const response = await fetch(`${config.flyApiHostname}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.flyApiToken}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new FlyClientError(`Fly API ${method} ${path} failed with ${response.status}.`, parsed || text);
  }

  return parsed;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function makeShortId() {
  return randomUUID().split("-").at(-1).slice(0, 10).toLowerCase();
}

export function makeAgentFlyNames() {
  const shortId = makeShortId();
  return {
    appName: `atlas-agent-${shortId}`,
    volumeName: `atlas_data_${shortId.replaceAll("-", "_")}`
  };
}

export async function getMachine(appName, machineId) {
  return flyRequest(`/apps/${appName}/machines/${machineId}`);
}

export async function waitForMachine(appName, machineId, state = "started", timeout = 60) {
  return flyRequest(`/apps/${appName}/machines/${machineId}/wait?state=${state}&timeout=${timeout}`);
}

export async function suspendMachine(appName, machineId) {
  await flyRequest(`/apps/${appName}/machines/${machineId}/suspend`, { method: "POST" });
  await waitForMachine(appName, machineId, "suspended", 60);
  return getMachine(appName, machineId);
}

export async function startMachine(appName, machineId) {
  await flyRequest(`/apps/${appName}/machines/${machineId}/start`, { method: "POST" });
  await waitForMachine(appName, machineId, "started", 60);
  return getMachine(appName, machineId);
}

export async function destroyApp(appName) {
  return flyRequest(`/apps/${appName}`, { method: "DELETE" });
}

export async function provisionClaudeAgent(args) {
  return provisionAgent({ ...args, image: config.claudeRuntimeImage, kind: "claude-agent" });
}

export async function provisionOpenCodeAgent(args) {
  return provisionAgent({ ...args, image: config.opencodeRuntimeImage, kind: "opencode-agent" });
}

export async function provisionPiAgent(args) {
  return provisionAgent({ ...args, image: config.piRuntimeImage, kind: "pi-agent" });
}

export async function provisionShellAgent(args) {
  return provisionAgent({ ...args, image: config.runtimeImage, kind: "shell-agent" });
}

export async function provisionCodexAgent(args) {
  return provisionAgent({ ...args, image: config.codexRuntimeImage, kind: "codex-agent" });
}

export async function provisionAiderAgent(args) {
  return provisionAgent({ ...args, image: config.aiderRuntimeImage, kind: "aider-agent" });
}

export async function provisionGooseAgent(args) {
  return provisionAgent({ ...args, image: config.gooseRuntimeImage, kind: "goose-agent" });
}

export async function provisionHermesAgent(args) {
  return provisionAgent({ ...args, image: config.hermesRuntimeImage, kind: "hermes-agent" });
}

export async function provisionCursorAgent(args) {
  return provisionAgent({ ...args, image: config.cursorRuntimeImage, kind: "cursor-agent" });
}

export async function provisionAntigravityAgent(args) {
  return provisionAgent({ ...args, image: config.antigravityRuntimeImage, kind: "antigravity-agent" });
}

export async function provisionCopilotAgent(args) {
  return provisionAgent({ ...args, image: config.copilotRuntimeImage, kind: "copilot-agent", copilotGhToken: config.copilotGhToken });
}

async function provisionAgent({
  appName,
  volumeName,
  region,
  image,
  kind = "shell-agent",
  githubRepo,
  githubToken,
  gitUserName,
  gitUserEmail,
  openrouterKey,
  composioEntityId,
  copilotGhToken,
}) {
  requireFlyConfig(image);

  await flyRequest("/apps", {
    method: "POST",
    body: {
      app_name: appName,
      org_slug: config.flyOrgSlug
    }
  });

  await allocateSharedIpv4(appName);
  await allocateIpv6(appName);

  const orKey = openrouterKey || config.openrouterApiKey;
  const secrets = [];
  if (orKey) {
    secrets.push({ key: "OPENROUTER_API_KEY", value: orKey });
    if (kind === "claude-agent") {
      // ANTHROPIC_BASE_URL is set by the Dockerfile to the local openrouter-proxy
      // (http://127.0.0.1:8082) which rewrites model IDs. Don't override it here.
      secrets.push({ key: "ANTHROPIC_API_KEY", value: orKey });
    }
    if (kind === "codex-agent") {
      // codex config.toml sets env_key = "OPENAI_API_KEY" and base_url = OpenRouter
      secrets.push({ key: "OPENAI_API_KEY", value: orKey });
    }
    // aider-agent uses OPENROUTER_API_KEY natively — already pushed above
    // cursor-agent uses CURSOR_LOCAL_AGENT_* set at runtime from OPENROUTER_API_KEY
  }
  if (config.supabaseUrl) {
    secrets.push({ key: "SUPABASE_URL", value: config.supabaseUrl });
    secrets.push({ key: "SUPABASE_ANON_KEY", value: config.supabaseAnonKey });
  }
  if (config.composioApiKey && kind !== "shell-agent") {
    secrets.push({ key: "COMPOSIO_API_KEY", value: config.composioApiKey });
    if (composioEntityId) {
      secrets.push({ key: "COMPOSIO_ENTITY_ID", value: composioEntityId });
    }
  }
  if (githubToken) {
    secrets.push({ key: "ATLAS_GITHUB_TOKEN", value: githubToken });
  }
  if (copilotGhToken && kind === "copilot-agent") {
    secrets.push({ key: "GH_TOKEN", value: copilotGhToken });
  }
  if (secrets.length) {
    await flyGraphql({
      query: "mutation($input: SetSecretsInput!) { setSecrets(input: $input) { release { id } } }",
      variables: {
        input: { appId: appName, secrets, replaceAll: false }
      }
    });
  }

  const volume = await flyRequest(`/apps/${appName}/volumes`, {
    method: "POST",
    body: {
      name: volumeName,
      region,
      size_gb: 1,
      snapshot_retention: 1
    }
  });

  const machine = await flyRequest(`/apps/${appName}/machines`, {
    method: "POST",
    body: {
      name: "shell-agent",
      region,
      config: {
        image,
        env: Object.fromEntries(
          Object.entries({
            AGENT_KIND: kind,
            ATLAS_GITHUB_REPO: githubRepo,
            ATLAS_GIT_USER_NAME: gitUserName,
            ATLAS_GIT_USER_EMAIL: gitUserEmail
          }).filter(([, v]) => v)
        ),
        guest: {
          cpu_kind: "shared",
          cpus: 1,
          memory_mb: 1024
        },
        mounts: [
          {
            volume: volumeName,
            path: "/data"
          }
        ],
        services: [
          {
            protocol: "tcp",
            internal_port: 7681,
            autostop: "suspend",
            autostart: true,
            ports: [
              {
                port: 80,
                handlers: ["http"],
                force_https: true
              },
              {
                port: 443,
                handlers: ["tls", "http"]
              }
            ]
          }
        ]
      }
    }
  });

  await waitForMachine(appName, machine.id, "started", 60);

  return {
    appName,
    machineId: machine.id,
    volumeName,
    volumeId: volume.id,
    region,
    terminalUrl: `https://${appName}.fly.dev`
  };
}

async function allocateSharedIpv4(appName) {
  return flyGraphql({
    query: "mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { app { sharedIpAddress } } }",
    variables: {
      input: {
        appId: appName,
        type: "shared_v4",
        region: ""
      }
    }
  });
}

async function allocateIpv6(appName) {
  return flyGraphql({
    query: "mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { ipAddress { id address type region createdAt } } }",
    variables: {
      input: {
        appId: appName,
        type: "v6",
        region: ""
      }
    }
  });
}

async function flyGraphql(body) {
  const response = await fetch("https://api.fly.io/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.flyApiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const parsed = text ? safeJson(text) : null;
  if (!response.ok || parsed?.errors) {
    throw new FlyClientError(`Fly GraphQL request failed with ${response.status}.`, parsed || text);
  }

  return parsed;
}

