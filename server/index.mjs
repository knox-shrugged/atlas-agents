import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config, publicConfig } from "./config.mjs";
import {
  createAgentRecord,
  createWorkspace,
  getAgent,
  getWorkspace,
  listAgents,
  listWorkspaces,
  updateAgent
} from "./db.mjs";
import {
  getMachine,
  makeAgentFlyNames,
  provisionClaudeAgent,
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

app.post("/api/workspaces/:workspaceId/agents", { preHandler: authenticate }, async (request, reply) => {
  const workspace = getWorkspace(request.params.workspaceId);
  if (!workspace) {
    return reply.code(404).send({ error: "Workspace not found." });
  }

  const kind = request.body?.kind || "shell-agent";
  if (!["shell-agent", "opencode-agent", "claude-agent", "pi-agent"].includes(kind)) {
    return reply.code(400).send({ error: "kind must be shell-agent, opencode-agent, claude-agent, or pi-agent." });
  }

  const githubRepo = request.body?.githubRepo || null;
  const githubToken = request.body?.githubToken || null;
  const gitUserName = request.body?.gitUserName || null;
  const gitUserEmail = request.body?.gitUserEmail || null;

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
    provisionShellAgent;

  try {
    const provisioned = await provision({
      appName,
      volumeName,
      region: config.defaultRegion,
      githubRepo,
      githubToken,
      gitUserName,
      gitUserEmail
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
    const refreshed = await updateAgent(agent.id, {
      status: mapMachineState(machine.state),
      lastError: null
    });
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
    return { agent: updated, machine };
  } catch (error) {
    const updated = await updateAgent(agent.id, {
      status: "error",
      lastError: serializeError(error)
    });
    return reply.code(502).send({ agent: updated, error: "Failed to resume Fly machine." });
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

