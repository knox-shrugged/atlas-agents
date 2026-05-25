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
