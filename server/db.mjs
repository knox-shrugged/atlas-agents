import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = join(process.cwd(), "data", "atlaslives.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    user_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    fly_app_name TEXT,
    fly_machine_id TEXT,
    fly_volume_name TEXT,
    fly_volume_id TEXT,
    fly_region TEXT,
    terminal_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_error TEXT,
    github_repo TEXT,
    github_token TEXT,
    git_user_name TEXT,
    git_user_email TEXT
  );
`);

try { db.exec("ALTER TABLE workspaces ADD COLUMN user_id TEXT;"); } catch (_) {}
try { db.exec("ALTER TABLE agents ADD COLUMN github_repo TEXT;"); } catch (_) {}
try { db.exec("ALTER TABLE agents ADD COLUMN github_token TEXT;"); } catch (_) {}
try { db.exec("ALTER TABLE agents ADD COLUMN git_user_name TEXT;"); } catch (_) {}
try { db.exec("ALTER TABLE agents ADD COLUMN git_user_email TEXT;"); } catch (_) {}

export function nowIso() {
  return new Date().toISOString();
}

export function createWorkspace({ id, name, userId }) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO workspaces (id, name, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, userId || null, now, now);
  return getWorkspace(id);
}

export function listWorkspaces(userId) {
  return db.prepare(`
    SELECT * FROM workspaces WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC
  `).all(userId || null);
}

export function getWorkspace(id, userId) {
  return db.prepare(`
    SELECT * FROM workspaces WHERE id = ? AND (user_id = ? OR user_id IS NULL)
  `).get(id, userId || null);
}

export function createAgentRecord(agent) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO agents (
      id, workspace_id, name, kind, status, fly_app_name, fly_machine_id,
      fly_volume_name, fly_volume_id, fly_region, terminal_url,
      created_at, updated_at, last_error, github_repo, github_token,
      git_user_name, git_user_email
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent.id,
    agent.workspaceId,
    agent.name,
    agent.kind,
    agent.status,
    agent.flyAppName || null,
    agent.flyMachineId || null,
    agent.flyVolumeName || null,
    agent.flyVolumeId || null,
    agent.flyRegion || null,
    agent.terminalUrl || null,
    now,
    now,
    agent.lastError || null,
    agent.githubRepo || null,
    agent.githubToken || null,
    agent.gitUserName || null,
    agent.gitUserEmail || null
  );
  return getAgent(agent.id);
}

export function listAgents(workspaceId) {
  return db.prepare(`
    SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at DESC
  `).all(workspaceId);
}

export function getAgent(id) {
  return db.prepare(`
    SELECT * FROM agents WHERE id = ?
  `).get(id);
}

export function updateAgent(id, fields) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return getAgent(id);
  }

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
    gitUserEmail: "git_user_email"
  };

  const assignments = [];
  const values = [];
  for (const [key, value] of entries) {
    const column = columnMap[key];
    if (!column) {
      continue;
    }
    assignments.push(`${column} = ?`);
    values.push(value);
  }

  assignments.push("updated_at = ?");
  values.push(nowIso(), id);

  db.prepare(`
    UPDATE agents
    SET ${assignments.join(", ")}
    WHERE id = ?
  `).run(...values);

  return getAgent(id);
}

