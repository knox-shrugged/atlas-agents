import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config, publicConfig } from "./config.mjs";
import {
  createAgentRecord,
  createWorkspace,
  deleteAgent,
  deleteWorkspace,
  getAgent,
  getWorkspace,
  getUserProfile,
  getUserUptime,
  listAgents,
  listAllUserUptime,
  listUserProfiles,
  listWorkspaces,
  logMachineEvent,
  updateAgent,
  upsertUserProfile,
} from "./db.mjs";
import { createOpenRouterKey, getKeyActivity, getKeyUsage } from "./openrouter.mjs";
import { listAuthConfigs, searchToolkits, ensureAuthConfig, getConnectedAccounts, createConnectionLink, deleteConnectedAccount } from "./composio.mjs";
import {
  destroyApp,
  getMachine,
  makeAgentFlyNames,
  provisionAiderAgent,
  provisionGooseAgent,
  provisionHermesAgent,
  provisionClaudeAgent,
  provisionCodexAgent,
  provisionOpenCodeAgent,
  provisionPiAgent,
  provisionShellAgent,
  startMachine,
  suspendMachine
} from "./fly-client.mjs";

const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function authenticate(request, reply) {
  const token = request.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return reply.code(401).send({ error: "Unauthorized" });
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return reply.code(401).send({ error: "Unauthorized" });
  request.userId = user.id;
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [
    "http://localhost:5173",
    "https://atlas-agents-spike.vercel.app",
  ],
  credentials: true,
});

app.get("/api/health", async () => ({
  ok: true,
  config: publicConfig()
}));

app.get("/api/costs", { preHandler: authenticate }, async (_req, reply) => {
  const { flyApiToken, openrouterApiKey, vercelToken, supabasePat } = config;
  const VERCEL_TEAM = "team_1tOEYeZtDbrRUJLe5HnIzgBX";
  const SUPABASE_ORG = "ogoegolxrzjxhqnmrhwv";

  const [orResult, flyResult, vercelResult, sbResult] = await Promise.allSettled([
    // OpenRouter
    fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${openrouterApiKey}` }
    }).then(r => r.json()).then(r => {
      const d = r.data || r;
      return { label: "OpenRouter", plan: d.is_free_tier ? "free" : "paid",
        usage_daily: d.usage_daily, usage_monthly: d.usage_monthly,
        usage_total: d.usage, limit: d.limit, limit_remaining: d.limit_remaining };
    }),

    // Fly.io — machine count via GraphQL
    fetch("https://api.fly.io/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${flyApiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{ organization(slug:"personal") { apps { nodes { name machines { nodes { id state } } } } } }` })
    }).then(r => r.json()).then(r => {
      const apps = r.data?.organization?.apps?.nodes || [];
      const machines = apps.flatMap(a => a.machines?.nodes || []);
      const byState = machines.reduce((acc, m) => { acc[m.state] = (acc[m.state] || 0) + 1; return acc; }, {});
      return { label: "Fly.io", plan: "pay-as-you-go",
        apps: apps.length, machines_total: machines.length, machines_by_state: byState,
        est_hourly_usd: (byState.started || 0) * 0.00031 };
    }),

    // Vercel — team billing info
    fetch(`https://api.vercel.com/v2/teams/${VERCEL_TEAM}`, {
      headers: { Authorization: `Bearer ${vercelToken}` }
    }).then(r => r.json()).then(r => ({
      label: "Vercel", plan: r.billing?.plan || "hobby",
      status: r.billing?.status, monthly_usd: r.billing?.plan === "hobby" ? 0 : null
    })),

    // Supabase — project info via PAT
    fetch("https://api.supabase.com/v1/projects", {
      headers: { Authorization: `Bearer ${supabasePat}` }
    }).then(r => r.json()).then(projects => {
      const p = (projects || []).find(p => p.id === "nsqpzqyykpeqoyokwutb") || {};
      return { label: "Supabase", plan: "free", status: p.status, region: p.region, monthly_usd: 0 };
    }),
  ]);

  return {
    openrouter: orResult.status === "fulfilled" ? orResult.value : { error: orResult.reason?.message },
    fly: flyResult.status === "fulfilled" ? flyResult.value : { error: flyResult.reason?.message },
    vercel: vercelResult.status === "fulfilled" ? vercelResult.value : { error: vercelResult.reason?.message },
    supabase: sbResult.status === "fulfilled" ? sbResult.value : { error: sbResult.reason?.message },
  };
});

app.get("/api/workspaces", { preHandler: authenticate }, async (request) => ({
  workspaces: await listWorkspaces(request.userId)
}));

app.post("/api/workspaces", { preHandler: authenticate }, async (request, reply) => {
  const name = cleanName(request.body?.name, "Demo Workspace");
  const workspace = await createWorkspace({
    id: randomUUID(),
    name,
    userId: request.userId
  });
  reply.code(201);
  return { workspace };
});

app.get("/api/workspaces/:workspaceId", { preHandler: authenticate }, async (request, reply) => {
  const workspace = await getWorkspace(request.params.workspaceId, request.userId);
  if (!workspace) {
    return reply.code(404).send({ error: "Workspace not found." });
  }
  return {
    workspace,
    agents: await listAgents(workspace.id)
  };
});

app.delete("/api/workspaces/:workspaceId", { preHandler: authenticate }, async (request, reply) => {
  const workspace = await getWorkspace(request.params.workspaceId, request.userId);
  if (!workspace) {
    return reply.code(404).send({ error: "Workspace not found." });
  }

  const agents = await listAgents(workspace.id);
  await Promise.all(agents.map(async (agent) => {
    if (agent.fly_app_name) {
      try {
        await destroyApp(agent.fly_app_name);
      } catch (error) {
        app.log.warn(`Failed to destroy Fly app ${agent.fly_app_name}: ${error.message}`);
      }
    }
    await logMachineEvent(agent.id, request.userId, agent.fly_app_name, "deleted");
    await deleteAgent(agent.id);
  }));

  await deleteWorkspace(workspace.id);
  reply.code(204).send();
});

app.post("/api/workspaces/:workspaceId/agents", { preHandler: authenticate }, async (request, reply) => {
  const workspace = await getWorkspace(request.params.workspaceId, request.userId);
  if (!workspace) {
    return reply.code(404).send({ error: "Workspace not found." });
  }

  const kind = request.body?.kind || "shell-agent";
  if (!["shell-agent", "opencode-agent", "claude-agent", "pi-agent", "codex-agent", "aider-agent", "goose-agent", "hermes-agent"].includes(kind)) {
    return reply.code(400).send({ error: "kind must be shell-agent, opencode-agent, claude-agent, pi-agent, codex-agent, aider-agent, goose-agent, or hermes-agent." });
  }

  const githubRepo = request.body?.githubRepo || null;
  const githubToken = request.body?.githubToken || null;
  const gitUserName = request.body?.gitUserName || null;
  const gitUserEmail = request.body?.gitUserEmail || null;

  // Ensure user has an OpenRouter sub-key; create one if not.
  let userProfile = await getUserProfile(request.userId);
  if (!userProfile?.openrouter_key && config.openrouterProvisionerKey) {
    try {
      const { key, hash } = await createOpenRouterKey(`user-${request.userId}`);
      userProfile = await upsertUserProfile(request.userId, {
        openrouterKey: key,
        openrouterKeyHash: hash,
      });
    } catch (err) {
      app.log.warn(`Could not provision OpenRouter key for user ${request.userId}: ${err.message}`);
    }
  }

  const id = randomUUID();
  const { appName, volumeName } = makeAgentFlyNames();
  let agent = await createAgentRecord({
    id,
    workspaceId: workspace.id,
    name: cleanName(request.body?.name, "Shell Agent"),
    kind,
    status: "creating",
    flyAppName: appName,
    flyVolumeName: volumeName,
    flyRegion: config.defaultRegion,
    githubRepo,
    githubToken,
    gitUserName,
    gitUserEmail
  });

  const provision =
    kind === "opencode-agent" ? provisionOpenCodeAgent :
    kind === "claude-agent" ? provisionClaudeAgent :
    kind === "pi-agent" ? provisionPiAgent :
    kind === "codex-agent" ? provisionCodexAgent :
    kind === "aider-agent" ? provisionAiderAgent :
    kind === "goose-agent" ? provisionGooseAgent :
    kind === "hermes-agent" ? provisionHermesAgent :
    provisionShellAgent;

  try {
    const provisioned = await provision({
      appName,
      volumeName,
      region: config.defaultRegion,
      githubRepo,
      githubToken,
      gitUserName,
      gitUserEmail,
      openrouterKey: userProfile?.openrouter_key ?? null,
      composioEntityId: request.userId,
    });
    agent = await updateAgent(id, {
      status: "running",
      flyAppName: provisioned.appName,
      flyMachineId: provisioned.machineId,
      flyVolumeName: provisioned.volumeName,
      flyVolumeId: provisioned.volumeId,
      flyRegion: provisioned.region,
      terminalUrl: provisioned.terminalUrl,
      lastError: null
    });
    await logMachineEvent(id, request.userId, provisioned.appName, "created");
    await logMachineEvent(id, request.userId, provisioned.appName, "started");
  } catch (error) {
    agent = await updateAgent(id, {
      status: "error",
      lastError: serializeError(error)
    });
  }

  reply.code(201);
  return { agent };
});

app.get("/api/agents/:agentId", { preHandler: authenticate }, async (request, reply) => {
  const agent = await getAgent(request.params.agentId);
  if (!agent) {
    return reply.code(404).send({ error: "Agent not found." });
  }
  return { agent };
});

app.post("/api/agents/:agentId/refresh", { preHandler: authenticate }, async (request, reply) => {
  const agent = await getAgent(request.params.agentId);
  if (!agent) {
    return reply.code(404).send({ error: "Agent not found." });
  }
  if (!agent.fly_app_name || !agent.fly_machine_id) {
    return { agent };
  }

  try {
    const machine = await getMachine(agent.fly_app_name, agent.fly_machine_id);
    const newStatus = mapMachineState(machine.state);

    // Fly auto-suspends machines silently — catch up the event log here.
    if (newStatus === "suspended" && agent.status === "running") {
      await logMachineEvent(agent.id, request.userId, agent.fly_app_name, "suspended");
    }

    const refreshed = await updateAgent(agent.id, { status: newStatus, lastError: null });
    return { agent: refreshed, machine };
  } catch (error) {
    const updated = await updateAgent(agent.id, {
      lastError: serializeError(error)
    });
    return reply.code(502).send({ agent: updated, error: "Failed to refresh Fly machine." });
  }
});

app.post("/api/agents/:agentId/suspend", { preHandler: authenticate }, async (request, reply) => {
  const agent = await getAgent(request.params.agentId);
  if (!agent) {
    return reply.code(404).send({ error: "Agent not found." });
  }
  if (!agent.fly_app_name || !agent.fly_machine_id) {
    return reply.code(400).send({ error: "Agent has no Fly machine yet." });
  }

  await updateAgent(agent.id, { status: "suspending", lastError: null });
  try {
    const machine = await suspendMachine(agent.fly_app_name, agent.fly_machine_id);
    const updated = await updateAgent(agent.id, {
      status: mapMachineState(machine.state),
      lastError: null
    });
    await logMachineEvent(agent.id, request.userId, agent.fly_app_name, "suspended");
    return { agent: updated, machine };
  } catch (error) {
    const updated = await updateAgent(agent.id, {
      status: "error",
      lastError: serializeError(error)
    });
    return reply.code(502).send({ agent: updated, error: "Failed to suspend Fly machine." });
  }
});

app.post("/api/agents/:agentId/resume", { preHandler: authenticate }, async (request, reply) => {
  const agent = await getAgent(request.params.agentId);
  if (!agent) {
    return reply.code(404).send({ error: "Agent not found." });
  }
  if (!agent.fly_app_name || !agent.fly_machine_id) {
    return reply.code(400).send({ error: "Agent has no Fly machine yet." });
  }

  await updateAgent(agent.id, { status: "resuming", lastError: null });
  try {
    const machine = await startMachine(agent.fly_app_name, agent.fly_machine_id);
    const updated = await updateAgent(agent.id, {
      status: mapMachineState(machine.state),
      lastError: null
    });
    await logMachineEvent(agent.id, request.userId, agent.fly_app_name, "started");
    return { agent: updated, machine };
  } catch (error) {
    const updated = await updateAgent(agent.id, {
      status: "error",
      lastError: serializeError(error)
    });
    return reply.code(502).send({ agent: updated, error: "Failed to resume Fly machine." });
  }
});

app.get("/api/me", { preHandler: authenticate }, async (request) => {
  const profile = await getUserProfile(request.userId);
  return {
    userId: request.userId,
    isAdmin: profile?.is_admin ?? false,
    hasOpenRouterKey: Boolean(profile?.openrouter_key),
  };
});

app.get("/api/usage", { preHandler: authenticate }, async (request) => {
  const [uptime, profile] = await Promise.all([
    getUserUptime(request.userId),
    getUserProfile(request.userId),
  ]);
  const hash = profile?.openrouter_key_hash ?? null;
  const [orUsage, models] = await Promise.all([
    getKeyUsage(hash),
    getKeyActivity(hash),
  ]);
  return { uptime, openrouter: orUsage, models };
});

app.get("/api/admin/usage", { preHandler: authenticate }, async (request, reply) => {
  const profile = await getUserProfile(request.userId);
  if (!profile?.is_admin) return reply.code(403).send({ error: "Forbidden." });

  const [profiles, uptimes, { data: { users } }] = await Promise.all([
    listUserProfiles(),
    listAllUserUptime(),
    supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const uptimeByUser = Object.fromEntries(uptimes.map((u) => [u.user_id, u]));
  const emailByUser = Object.fromEntries((users ?? []).map((u) => [u.id, u.email]));

  const rows = await Promise.all(
    profiles.map(async (p) => {
      const orUsage = await getKeyUsage(p.openrouter_key_hash);
      return {
        userId: p.user_id,
        email: emailByUser[p.user_id] ?? null,
        isAdmin: p.is_admin,
        uptime: uptimeByUser[p.user_id] ?? { uptime_seconds: 0, agent_count: 0 },
        openrouter: orUsage,
      };
    })
  );

  return { users: rows };
});

app.delete("/api/agents/:agentId", { preHandler: authenticate }, async (request, reply) => {
  const agent = await getAgent(request.params.agentId);
  if (!agent) {
    return reply.code(404).send({ error: "Agent not found." });
  }

  if (agent.fly_app_name) {
    try {
      await destroyApp(agent.fly_app_name);
    } catch (error) {
      app.log.warn(`Failed to destroy Fly app ${agent.fly_app_name}: ${error.message}`);
    }
  }

  await logMachineEvent(agent.id, request.userId, agent.fly_app_name, "deleted");
  await deleteAgent(agent.id);
  reply.code(204).send();
});

app.get("/api/composio/toolkits", { preHandler: authenticate }, async (request, reply) => {
  if (!config.composioApiKey) return reply.code(503).send({ error: "Composio not configured." });
  const q = request.query?.q;
  if (q !== undefined) {
    const results = await searchToolkits(q);
    return { toolkits: results };
  }
  const toolkits = await listAuthConfigs();
  return { toolkits };
});

app.get("/api/composio/connections", { preHandler: authenticate }, async (request, reply) => {
  if (!config.composioApiKey) return reply.code(503).send({ error: "Composio not configured." });
  const connections = await getConnectedAccounts(request.userId);
  return { connections };
});

app.post("/api/composio/connections", { preHandler: authenticate }, async (request, reply) => {
  if (!config.composioApiKey) return reply.code(503).send({ error: "Composio not configured." });
  const { authConfigId, toolkitSlug, redirectUrl } = request.body || {};
  if (!authConfigId && !toolkitSlug) return reply.code(400).send({ error: "authConfigId or toolkitSlug is required." });
  try {
    const configId = authConfigId ?? await ensureAuthConfig(toolkitSlug);
    if (!configId) return reply.code(400).send({ error: `No composio-managed auth config available for ${toolkitSlug}.` });
    const result = await createConnectionLink(
      configId,
      request.userId,
      redirectUrl || "https://atlas-agents-spike.vercel.app"
    );
    return { redirectUrl: result.redirect_url, connectionId: result.connected_account_id };
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

app.delete("/api/composio/connections/:connectionId", { preHandler: authenticate }, async (request, reply) => {
  if (!config.composioApiKey) return reply.code(503).send({ error: "Composio not configured." });
  try {
    await deleteConnectedAccount(request.params.connectionId);
    reply.code(204).send();
  } catch (err) {
    return reply.code(502).send({ error: err.message });
  }
});

function cleanName(value, fallback) {
  return String(value || fallback).trim().slice(0, 80) || fallback;
}

function mapMachineState(state) {
  if (state === "started") return "running";
  if (state === "suspended") return "suspended";
  if (state === "stopped") return "suspended";
  if (state === "starting") return "resuming";
  if (state === "stopping" || state === "suspending") return "suspending";
  return state || "unknown";
}

function serializeError(error) {
  if (!error) return "Unknown error";
  const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
  return `${error.message || String(error)}${details}`.slice(0, 2000);
}

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

