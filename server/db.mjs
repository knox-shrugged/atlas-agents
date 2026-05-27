import { createClient } from "@supabase/supabase-js";
import { config } from "./config.mjs";

const db = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function nowIso() {
  return new Date().toISOString();
}

function dbError(context, error) {
  throw new Error(`DB ${context}: ${error.message}`);
}

export async function createWorkspace({ id, name, userId }) {
  const now = nowIso();
  const { data, error } = await db.from("workspaces").insert({
    id, name, user_id: userId || null, created_at: now, updated_at: now
  }).select().single();
  if (error) dbError("createWorkspace", error);
  return data;
}

export async function listWorkspaces(userId) {
  const { data, error } = await db.from("workspaces")
    .select("*")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("created_at", { ascending: false });
  if (error) dbError("listWorkspaces", error);
  return data;
}

export async function getWorkspace(id, userId) {
  const { data, error } = await db.from("workspaces")
    .select("*")
    .eq("id", id)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .single();
  if (error) return null;
  return data;
}

export async function createAgentRecord(agent) {
  const now = nowIso();
  const { data, error } = await db.from("workspace_agents").insert({
    id: agent.id,
    workspace_id: agent.workspaceId,
    name: agent.name,
    kind: agent.kind,
    status: agent.status,
    fly_app_name: agent.flyAppName || null,
    fly_machine_id: agent.flyMachineId || null,
    fly_volume_name: agent.flyVolumeName || null,
    fly_volume_id: agent.flyVolumeId || null,
    fly_region: agent.flyRegion || null,
    terminal_url: agent.terminalUrl || null,
    last_error: agent.lastError || null,
    github_repo: agent.githubRepo || null,
    github_token: agent.githubToken || null,
    git_user_name: agent.gitUserName || null,
    git_user_email: agent.gitUserEmail || null,
    created_at: now,
    updated_at: now,
  }).select().single();
  if (error) dbError("createAgentRecord", error);
  return data;
}

export async function listAgents(workspaceId) {
  const { data, error } = await db.from("workspace_agents")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) dbError("listAgents", error);
  return data;
}

export async function getAgent(id) {
  const { data, error } = await db.from("workspace_agents")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function deleteWorkspace(id) {
  const { error } = await db.from("workspaces").delete().eq("id", id);
  if (error) dbError("deleteWorkspace", error);
}

export async function getUserProfile(userId) {
  const { data } = await db.from("user_profiles").select("*").eq("user_id", userId).single();
  return data ?? null;
}

export async function upsertUserProfile(userId, fields) {
  const now = nowIso();
  const update = { user_id: userId, updated_at: now };
  if (fields.openrouterKey !== undefined) update.openrouter_key = fields.openrouterKey;
  if (fields.openrouterKeyHash !== undefined) update.openrouter_key_hash = fields.openrouterKeyHash;
  const { data, error } = await db.from("user_profiles")
    .upsert(update, { onConflict: "user_id" })
    .select().single();
  if (error) dbError("upsertUserProfile", error);
  return data;
}

export async function listUserProfiles() {
  const { data, error } = await db.from("user_profiles").select("*");
  if (error) dbError("listUserProfiles", error);
  return data ?? [];
}

export async function getUserUptime(userId) {
  const { data } = await db.from("user_uptime").select("*").eq("user_id", userId).single();
  return data ?? { uptime_seconds: 0, agent_count: 0 };
}

export async function listAllUserUptime() {
  const { data, error } = await db.from("user_uptime").select("*");
  if (error) dbError("listAllUserUptime", error);
  return data ?? [];
}

export async function getModelUsageForUser(userId) {
  const { data: workspaces } = await db.from("workspaces").select("id").eq("user_id", userId);
  if (!workspaces?.length) return [];

  const wsIds = workspaces.map((w) => w.id);
  const { data: agents } = await db.from("workspace_agents")
    .select("fly_app_name")
    .in("workspace_id", wsIds)
    .not("fly_app_name", "is", null);
  if (!agents?.length) return [];

  const appNames = [...new Set(agents.map((a) => a.fly_app_name).filter(Boolean))];
  const { data } = await db.from("model_usage").select("model, tokens_in, tokens_out").in("fly_app_name", appNames);
  if (!data?.length) return [];

  const byModel = {};
  for (const row of data) {
    if (!byModel[row.model]) byModel[row.model] = { model: row.model, tokens_in: 0, tokens_out: 0 };
    byModel[row.model].tokens_in  += row.tokens_in;
    byModel[row.model].tokens_out += row.tokens_out;
  }
  return Object.values(byModel).sort((a, b) => (b.tokens_in + b.tokens_out) - (a.tokens_in + a.tokens_out));
}

export async function logMachineEvent(agentId, userId, flyAppName, event) {
  const { error } = await db.from("machine_events").insert({
    agent_id: agentId,
    user_id: userId,
    fly_app_name: flyAppName,
    event,
  });
  if (error) dbError("logMachineEvent", error);
}

export async function deleteAgent(id) {
  const { error } = await db.from("workspace_agents").delete().eq("id", id);
  if (error) dbError("deleteAgent", error);
}

export async function updateAgent(id, fields) {
  const columnMap = {
    status: "status",
    flyAppName: "fly_app_name",
    flyMachineId: "fly_machine_id",
    flyVolumeName: "fly_volume_name",
    flyVolumeId: "fly_volume_id",
    flyRegion: "fly_region",
    terminalUrl: "terminal_url",
    lastError: "last_error",
    githubRepo: "github_repo",
    githubToken: "github_token",
    gitUserName: "git_user_name",
    gitUserEmail: "git_user_email",
  };

  const update = { updated_at: nowIso() };
  for (const [key, value] of Object.entries(fields)) {
    const col = columnMap[key];
    if (col) update[col] = value ?? null;
  }

  const { data, error } = await db.from("workspace_agents")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) dbError("updateAgent", error);
  return data;
}
