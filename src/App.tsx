import { useEffect, useRef, useState } from "react";

const AGENT_KINDS = [
  { value: "aider-agent",       label: "aider-agent — Qwen2.5-Coder via OpenRouter" },
  { value: "antigravity-agent", label: "antigravity-agent — Google Antigravity (OAuth)" },
  { value: "claude-agent",      label: "claude-agent — Claude via OpenRouter" },
  { value: "codex-agent",       label: "codex-agent — o4-mini via OpenRouter" },
  { value: "copilot-agent",     label: "copilot-agent — GitHub Copilot (GH_TOKEN)" },
  { value: "cursor-agent",      label: "cursor-agent — Cursor Agent via OpenRouter" },
  { value: "gemini-agent",      label: "gemini-agent — Gemini 2.5 Pro (OAuth)" },
  { value: "goose-agent",       label: "goose-agent — Gemini 2.5 Flash via OpenRouter" },
  { value: "hermes-agent",      label: "hermes-agent — self-improving agent via OpenRouter" },
  { value: "opencode-agent",    label: "opencode-agent — Gemini 2.5 Flash" },
  { value: "openhands-agent",   label: "openhands-agent — autonomous coding agent via OpenRouter" },
  { value: "pi-agent",          label: "pi-agent — pi.dev via OpenRouter" },
] as const;

type AgentKind = typeof AGENT_KINDS[number]["value"];

function defaultAgentName(kind: AgentKind): string {
  return kind.replace(/-agent$/, "").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") + " Agent";
}
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { cn } from "./lib/utils";
import { Modal } from "./components/ui/modal";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./components/ui/resizable";
import {
  Bot,
  ChevronRight,
  Terminal,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Plus,
  LogOut,
  Trash2,
  BarChart2,
  ShieldCheck,
  Plug,
  Unplug,
  ExternalLink,
  Search,
} from "lucide-react";

type NavItem = "agents" | "usage" | "connections" | "admin";

type Workspace = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type Agent = {
  id: string;
  workspace_id: string;
  name: string;
  kind: string;
  status: string;
  fly_app_name: string | null;
  fly_machine_id: string | null;
  fly_volume_name: string | null;
  fly_region: string | null;
  terminal_url: string | null;
  last_error: string | null;
};


type OrUsage = { usage: number; limit: number | null; limit_remaining: number | null; is_free_tier: boolean } | null;
type ModelUsageRow = { model: string; requests: number; prompt_tokens: number; completion_tokens: number; cost: number };

type ComposioToolkit = { id: string; name: string; toolkit: string; authScheme: string; isComposioManaged: boolean };
type ComposioConnection = { id: string; toolkit: string | null; authScheme: string; wordId: string; status: string | null };
type ComposioSearchResult = { slug: string; name: string; logo: string | null; toolsCount: number; description: string | null; composioManaged: boolean };

type UserUsage = {
  uptime: { uptime_seconds: number; agent_count: number };
  openrouter: OrUsage;
  models: ModelUsageRow[];
};

type AdminUserRow = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  uptime: { uptime_seconds: number; agent_count: number };
  openrouter: OrUsage;
};

type AdminUsage = { users: AdminUserRow[] };

type FlyMachine = {
  id: string;
  appName: string;
  state: string;
  region: string;
  createdAt: string;
  image: string | null;
};

const STATUS_DOT: Record<string, string> = {
  running: "bg-emerald-400",
  error: "bg-red-400",
  suspended: "bg-slate-400",
  suspending: "bg-yellow-400",
  resuming: "bg-blue-400",
  creating: "bg-purple-400",
};

function StatusBadge({ status }: { status: string }) {
  const dot = STATUS_DOT[status] ?? "bg-slate-400";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {status}
    </span>
  );
}

const NAV: { id: NavItem; label: string; icon: React.ElementType }[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "usage", label: "My Usage", icon: BarChart2 },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "admin", label: "Admin", icon: ShieldCheck },
];

export default function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        <div className="h-5 w-5 rounded-full border-2 border-slate-600 border-t-slate-300 animate-spin" />
      </div>
    );
  }

  if (!session) return <LoginPage />;
  return <App session={session} />;
}

function App({ session }: { session: Session }) {
  const [nav, setNav] = useState<NavItem>("agents");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loadedAgentIds, setLoadedAgentIds] = useState<Set<string>>(new Set());
  const [workspaceName, setWorkspaceName] = useState("Demo Workspace");
  const [agentKind, setAgentKind] = useState<AgentKind>("aider-agent");
  const [agentName, setAgentName] = useState(() => defaultAgentName("aider-agent"));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteAgent, setConfirmDeleteAgent] = useState<Agent | null>(null);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<Workspace | null>(null);
  const [sidebarAgentOpen, setSidebarAgentOpen] = useState(false);
  const sidebarCreating = useRef(false);
  const [sidebarWorkspaceOpen, setSidebarWorkspaceOpen] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [adminUsage, setAdminUsage] = useState<AdminUsage | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMachines, setAdminMachines] = useState<FlyMachine[] | null>(null);
  const [adminMachinesLoading, setAdminMachinesLoading] = useState(false);
  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ComposioSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    void loadInitialState();
  }, []);

  useEffect(() => {
    if (sidebarCreating.current && busy !== "agent") {
      sidebarCreating.current = false;
      setSidebarAgentOpen(false);
    }
  }, [busy]);

  async function loadInitialState() {
    const [healthRes, wsRes, meRes] = await Promise.all([
      api<{ ok: boolean }>("/api/health"),
      api<{ workspaces: Workspace[] }>("/api/workspaces"),
      api<{ isAdmin: boolean }>("/api/me"),
    ]);
    void healthRes;
    setIsAdmin(meRes.isAdmin);
    setWorkspaces(wsRes.workspaces);
    if (wsRes.workspaces[0]) await loadWorkspace(wsRes.workspaces[0].id);
  }

  async function deleteWorkspace(ws: Workspace) {
    await run(`delete-ws-${ws.id}`, async () => {
      await api(`/api/workspaces/${ws.id}`, { method: "DELETE" });
      const remaining = workspaces.filter((w) => w.id !== ws.id);
      setWorkspaces(remaining);
      setConfirmDeleteWorkspace(null);
      if (workspace?.id === ws.id) {
        if (remaining[0]) {
          await loadWorkspace(remaining[0].id);
        } else {
          setWorkspace(null);
          setAgents([]);
        }
      }
    });
  }

  async function loadUsage() {
    setUsageLoading(true);
    try {
      const data = await api<UserUsage>("/api/usage");
      setUsage(data);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setUsageLoading(false);
    }
  }

  async function loadAdminUsage() {
    setAdminLoading(true);
    try {
      const data = await api<AdminUsage>("/api/admin/usage");
      setAdminUsage(data);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setAdminLoading(false);
    }
  }

  async function loadAdminMachines() {
    setAdminMachinesLoading(true);
    try {
      const data = await api<{ machines: FlyMachine[] }>("/api/admin/machines");
      setAdminMachines(data.machines);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setAdminMachinesLoading(false);
    }
  }

  async function loadConnections() {
    setConnectionsLoading(true);
    try {
      const data = await api<{ connections: ComposioConnection[] }>("/api/composio/connections");
      setConnections(data.connections);
    } catch {
      // composio not configured — silently ignore
    } finally {
      setConnectionsLoading(false);
    }
  }

  async function searchComposio(q: string) {
    setSearchLoading(true);
    try {
      const data = await api<{ toolkits: ComposioSearchResult[] }>(`/api/composio/toolkits?q=${encodeURIComponent(q)}`);
      setSearchResults(data.toolkits);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function connectApp(toolkitSlug: string) {
    setConnectingApp(toolkitSlug);
    try {
      const data = await api<{ redirectUrl: string }>("/api/composio/connections", {
        method: "POST",
        body: { toolkitSlug, redirectUrl: window.location.origin },
      });
      window.open(data.redirectUrl, "_blank");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingApp(null);
    }
  }

  async function disconnectApp(connectionId: string) {
    try {
      await api(`/api/composio/connections/${connectionId}`, { method: "DELETE" });
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadWorkspace(id: string) {
    const data = await api<{ workspace: Workspace; agents: Agent[] }>(`/api/workspaces/${id}`);
    setWorkspace(data.workspace);
    setAgents(data.agents);
    setSelectedAgent(null);
    setLoadedAgentIds(new Set());
  }

  async function createWorkspace() {
    await run("workspace", async () => {
      const data = await api<{ workspace: Workspace }>("/api/workspaces", { method: "POST", body: { name: workspaceName } });
      setWorkspace(data.workspace);
      setAgents([]);
      setWorkspaces((prev) => [data.workspace, ...prev]);
      setNotice("Workspace created.");
    });
  }

  async function createAgent() {
    if (!workspace) return;
    await run("agent", async () => {
      const data = await api<{ agent: Agent }>(`/api/workspaces/${workspace.id}/agents`, {
        method: "POST",
        body: { name: agentName, kind: agentKind },
      });
      setAgents((prev) => [data.agent, ...prev]);
      selectAgent(data.agent);
      if (!data.agent.terminal_url) void pollAgentUntilReady(data.agent.id);
    });
  }

  async function pollAgentUntilReady(agentId: string) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const data = await api<{ agent: Agent }>(`/api/agents/${agentId}/refresh`, { method: "POST" });
        replaceAgent(data.agent);
        if (data.agent.terminal_url) return;
      } catch {
        // keep polling
      }
    }
  }

  async function refreshAgent(agent: Agent) {
    await run(`refresh-${agent.id}`, async () => {
      const data = await api<{ agent: Agent }>(`/api/agents/${agent.id}/refresh`, { method: "POST" });
      replaceAgent(data.agent);
    });
  }

  async function suspendAgent(agent: Agent) {
    await run(`suspend-${agent.id}`, async () => {
      const data = await api<{ agent: Agent }>(`/api/agents/${agent.id}/suspend`, { method: "POST" });
      replaceAgent(data.agent);
    });
  }

  async function resumeAgent(agent: Agent) {
    await run(`resume-${agent.id}`, async () => {
      const data = await api<{ agent: Agent }>(`/api/agents/${agent.id}/resume`, { method: "POST" });
      replaceAgent(data.agent);
    });
  }

  async function deleteAgent(agent: Agent) {
    await run(`delete-${agent.id}`, async () => {
      await api(`/api/agents/${agent.id}`, { method: "DELETE" });
      setAgents((prev) => prev.filter((a) => a.id !== agent.id));
      setSelectedAgent(null);
      setConfirmDeleteAgent(null);
    });
  }

  useEffect(() => {
    if (nav === "usage") void loadUsage();
    if (nav === "connections") {
      void loadConnections();
      void searchComposio(searchQuery);
    }
    if (nav === "admin") { void loadAdminUsage(); void loadAdminMachines(); }
  }, [nav]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onVisible() {
      if (!document.hidden && nav === "connections") void loadConnections();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [nav]); // eslint-disable-line react-hooks/exhaustive-deps

  function replaceAgent(agent: Agent) {
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
    setSelectedAgent((prev) => (prev?.id === agent.id ? agent : prev));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function selectAgent(agent: Agent) {
    setLoadedAgentIds((prev) => new Set([...prev, agent.id]));
    setSelectedAgent(agent);
    setConfirmDeleteAgent(null);
    setNav("agents");
  }

  return (
    <div className="h-screen bg-slate-50 font-sans">
      <ResizablePanelGroup direction="horizontal" autoSaveId="atlas-sidebar" className="h-full">
        <ResizablePanel defaultSize={20} minSize={10} maxSize={35}>
          {/* Sidebar */}
          <aside className="h-full flex flex-col bg-slate-900 text-slate-100 overflow-y-auto">
        {/* Logo + workspace switcher */}
        <div className="px-5 py-5 border-b border-slate-800">
          <p className="text-sm font-semibold tracking-wide text-slate-300 uppercase mb-2">AtlasLives</p>
          <div className="flex items-center gap-1.5">
            <select
              value={workspace?.id ?? ""}
              onChange={(e) => void loadWorkspace(e.target.value)}
              className="flex-1 min-w-0 truncate text-xs bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-500"
            >
              {!workspace && <option value="">No workspace</option>}
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
            <button
              onClick={() => setSidebarWorkspaceOpen(true)}
              className="flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shrink-0"
              title="New Workspace"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { if (workspace) setConfirmDeleteWorkspace(workspace); }}
              disabled={!workspace}
              className="flex items-center justify-center h-6 w-6 rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
              title="Delete Workspace"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {/* Agents nav + inline agent list */}
          <button
            onClick={() => { setNav("agents"); setSelectedAgent(null); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              nav === "agents"
                ? "bg-slate-700 text-white"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            )}
          >
            <Bot className="h-4 w-4 shrink-0" />
            Agents
            <div className="ml-auto flex items-center gap-1.5">
              {agents.length > 0 && (
                <span className="text-xs bg-slate-600 text-slate-200 rounded-full px-1.5 py-0.5 leading-none">
                  {agents.length}
                </span>
              )}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); setSidebarAgentOpen(true); }}
                className="flex items-center justify-center h-4 w-4 rounded text-slate-400 hover:text-white hover:bg-slate-500 transition-colors"
                title="New Agent"
              >
                <Plus className="h-3 w-3" />
              </span>
            </div>
          </button>

          {/* Agent list — always visible when agents exist */}
          {agents.length > 0 && (
            <div className="pb-1 space-y-0.5">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className={cn(
                    "group w-full flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                    selectedAgent?.id === agent.id && nav === "agents"
                      ? "bg-slate-600 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  )}
                  onClick={() => selectAgent(agent)}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[agent.status] ?? "bg-slate-400")} />
                  <span className="truncate flex-1">{agent.name}</span>
                  <Trash2
                    className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-slate-400 hover:text-red-400 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteAgent(agent); }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Other nav items */}
          {([
            { id: "usage" as NavItem, label: "My Usage", icon: BarChart2 },
            { id: "connections" as NavItem, label: "Connections", icon: Plug },
            ...(isAdmin ? [{ id: "admin" as NavItem, label: "Admin", icon: ShieldCheck }] : []),
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setNav(id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                nav === id
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* User / sign-out */}
        <div className="px-3 pb-4 pt-3 border-t border-slate-800 mt-auto">
          <div className="flex items-center gap-2 px-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-400 truncate">{session.user.email}</p>
            </div>
            <button
              onClick={() => void supabase.auth.signOut()}
              className="text-slate-500 hover:text-slate-300 transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
          </aside>
        </ResizablePanel>
        <ResizableHandle className="bg-slate-800 hover:bg-slate-600 transition-colors" />
        <ResizablePanel defaultSize={80}>
          {/* Main */}
          <div className="h-full flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-6 h-14 border-b border-slate-200 bg-white shrink-0">
          {nav === "agents" && selectedAgent ? (
            <>
              <button
                onClick={() => setSelectedAgent(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                title="Back to all agents"
              >
                <Bot className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-slate-800">{selectedAgent.name}</span>
              <span className="text-xs text-slate-400">{selectedAgent.kind}</span>
              <StatusBadge status={selectedAgent.status} />
              <div className="ml-auto flex items-center gap-2">
                {notice && <span className="text-xs text-slate-400 max-w-xs truncate">{notice}</span>}
                <IconButton
                  icon={RefreshCw}
                  label="Refresh"
                  onClick={() => void refreshAgent(selectedAgent)}
                  disabled={Boolean(busy)}
                  spin={busy === `refresh-${selectedAgent.id}`}
                />
                <IconButton
                  icon={PauseCircle}
                  label="Suspend"
                  onClick={() => void suspendAgent(selectedAgent)}
                  disabled={Boolean(busy) || !selectedAgent.fly_machine_id}
                />
                <IconButton
                  icon={PlayCircle}
                  label="Resume"
                  onClick={() => void resumeAgent(selectedAgent)}
                  disabled={Boolean(busy) || !selectedAgent.fly_machine_id}
                />
                {selectedAgent.terminal_url && (
                  <a
                    href={selectedAgent.terminal_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <Terminal className="h-3 w-3" />
                    New tab
                  </a>
                )}
                <div className="w-px h-4 bg-slate-200" />
                <IconButton
                  icon={Trash2}
                  label="Delete agent"
                  onClick={() => setConfirmDeleteAgent(selectedAgent)}
                  disabled={Boolean(busy)}
                />
              </div>
            </>
          ) : (
            <>
              <h1 className="text-sm font-semibold text-slate-800">
                {NAV.find((n) => n.id === nav)?.label}
              </h1>
              {workspace && <span className="text-xs text-slate-400">· {workspace.name}</span>}
              <div className="ml-auto flex items-center gap-2">
                {notice && <span className="text-xs text-slate-400 max-w-xs truncate">{notice}</span>}
                {nav === "agents" && (
                  <>
                    <AgentModalTrigger
                      label="New workspace"
                      variant="outline"
                      workspace={workspace}
                      workspaces={workspaces}
                      workspaceName={workspaceName}
                      agentName={agentName}
                      agentKind={agentKind}
                      busy={busy}
                      onWorkspaceNameChange={setWorkspaceName}
                      onAgentNameChange={setAgentName}
                      onAgentKindChange={(k) => { setAgentKind(k); setAgentName(defaultAgentName(k)); }}
                      onCreateWorkspace={createWorkspace}
                      onCreateAgent={createAgent}
                      onSelectWorkspace={loadWorkspace}
                      modal="workspace"
                    />
                    <AgentModalTrigger
                      label="New agent"
                      variant="primary"
                      workspace={workspace}
                      workspaces={workspaces}
                      workspaceName={workspaceName}
                      agentName={agentName}
                      agentKind={agentKind}
                      busy={busy}
                      onWorkspaceNameChange={setWorkspaceName}
                      onAgentNameChange={setAgentName}
                      onAgentKindChange={(k) => { setAgentKind(k); setAgentName(defaultAgentName(k)); }}
                      onCreateWorkspace={createWorkspace}
                      onCreateAgent={createAgent}
                      onSelectWorkspace={loadWorkspace}
                      modal="agent"
                    />
                  </>
                )}
              </div>
            </>
          )}
        </header>

        {/* Persistent iframe cache — one per visited agent, toggled with CSS */}
        {agents.filter((a) => a.terminal_url && loadedAgentIds.has(a.id)).map((agent) => (
          <iframe
            key={agent.id}
            src={agent.terminal_url!}
            title={`Terminal — ${agent.name}`}
            allow="clipboard-read; clipboard-write"
            className={cn(
              "border-0 w-full min-h-0",
              nav === "agents" && selectedAgent?.id === agent.id ? "flex-1" : "hidden"
            )}
          />
        ))}

        {/* No-terminal fallback */}
        {nav === "agents" && selectedAgent && !selectedAgent.terminal_url && (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={Terminal} title="No terminal URL" description="The agent is still provisioning or has no terminal configured." />
          </div>
        )}

        {/* Regular scrollable content — hidden while a terminal is active */}
        <main className={cn(
          "flex-1 overflow-y-auto p-6",
          nav === "agents" && selectedAgent ? "hidden" : ""
        )}>
          {nav === "agents" && (
            <AgentListView agents={agents} workspace={workspace} onSelect={selectAgent} onDelete={setConfirmDeleteAgent} />
          )}
          {nav === "usage" && (
            <UsageView usage={usage} loading={usageLoading} onRefresh={loadUsage} />
          )}
          {nav === "connections" && (
            <ConnectionsView
              connections={connections}
              connectionsLoading={connectionsLoading}
              searchQuery={searchQuery}
              searchResults={searchResults}
              searchLoading={searchLoading}
              connectingApp={connectingApp}
              onSearchChange={(q) => {
                setSearchQuery(q);
                if (q.length === 0 || q.length >= 3) void searchComposio(q);
              }}
              onConnect={connectApp}
              onDisconnect={disconnectApp}
              onRefreshConnections={loadConnections}
            />
          )}
          {nav === "admin" && (
            <AdminView usage={adminUsage} loading={adminLoading} onRefresh={loadAdminUsage} machines={adminMachines} machinesLoading={adminMachinesLoading} onRefreshMachines={loadAdminMachines} />
          )}
        </main>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      {/* Sidebar new-workspace modal */}
      <Modal
        open={sidebarWorkspaceOpen}
        onOpenChange={setSidebarWorkspaceOpen}
        title="New Workspace"
        description="Workspaces group related agents together."
        dismissable={busy !== "workspace"}
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { createWorkspace(); setSidebarWorkspaceOpen(false); } }}
              autoFocus
            />
          </Field>
          <Button
            onClick={() => { createWorkspace(); setSidebarWorkspaceOpen(false); }}
            disabled={Boolean(busy)}
            loading={busy === "workspace"}
          >
            Create workspace
          </Button>
        </div>
      </Modal>

      {/* Sidebar new-agent modal */}
      <Modal
        open={sidebarAgentOpen}
        onOpenChange={(v) => { if (!sidebarCreating.current) setSidebarAgentOpen(v); }}
        title="New Agent"
        description={workspace ? `Adding to "${workspace.name}"` : "Select a workspace first."}
        dismissable={busy !== "agent"}
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} autoFocus />
          </Field>
          <Field label="Kind">
            <select
              value={agentKind}
              onChange={(e) => { const k = e.target.value as AgentKind; setAgentKind(k); setAgentName(defaultAgentName(k)); }}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AGENT_KINDS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          {!workspace && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2">
              Select a workspace before creating an agent.
            </p>
          )}
          {busy === "agent" && (
            <p className="text-xs text-blue-600 bg-blue-50 rounded-md px-3 py-2">
              Provisioning Fly Machine — this takes about 30 seconds…
            </p>
          )}
          <Button
            onClick={() => { sidebarCreating.current = true; createAgent(); }}
            disabled={!workspace || Boolean(busy)}
            loading={busy === "agent"}
          >
            Create agent
          </Button>
        </div>
      </Modal>

      {/* Delete agent modal */}
      <Modal
        open={Boolean(confirmDeleteAgent)}
        onOpenChange={(open) => { if (!open) setConfirmDeleteAgent(null); }}
        title="Delete agent"
        description={confirmDeleteAgent ? `"${confirmDeleteAgent.name}" and its Fly machine will be permanently destroyed.` : undefined}
      >
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setConfirmDeleteAgent(null)}
            disabled={Boolean(busy)}
            className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmDeleteAgent && void deleteAgent(confirmDeleteAgent)}
            disabled={Boolean(busy)}
            className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy?.startsWith("delete-") ? "Deleting…" : "Delete agent"}
          </button>
        </div>
      </Modal>

      {/* Delete workspace modal */}
      <Modal
        open={Boolean(confirmDeleteWorkspace)}
        onOpenChange={(open) => { if (!open) setConfirmDeleteWorkspace(null); }}
        title="Delete workspace"
        description={confirmDeleteWorkspace ? `"${confirmDeleteWorkspace.name}" and all its agents will be permanently destroyed. This cannot be undone.` : undefined}
      >
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={() => setConfirmDeleteWorkspace(null)}
            disabled={Boolean(busy)}
            className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmDeleteWorkspace && void deleteWorkspace(confirmDeleteWorkspace)}
            disabled={Boolean(busy)}
            className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy?.startsWith("delete-ws-") ? "Deleting…" : "Delete workspace"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Agent list (shown when no agent selected) ─────────────────────────────────

function AgentListView({
  agents,
  workspace,
  onSelect,
  onDelete,
}: {
  agents: Agent[];
  workspace: Workspace | null;
  onSelect: (a: Agent) => void;
  onDelete: (a: Agent) => void;
}) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title={workspace ? "No agents yet" : "No workspace selected"}
        description={workspace ? "Click \"New agent\" to get started." : "Select or create a workspace first."}
      />
    );
  }
  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div
          key={agent.id}
          onClick={() => onSelect(agent)}
          className="cursor-pointer bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Bot className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="font-medium text-sm text-slate-800 truncate">{agent.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{agent.kind}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={agent.status} />
              <Terminal className="h-3.5 w-3.5 text-slate-300" />
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(agent); }}
                className="p-0.5 rounded text-slate-400 hover:text-red-500 transition-colors"
                title="Delete agent"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mt-3">
            {([
              ["App", agent.fly_app_name],
              ["Machine", agent.fly_machine_id?.slice(0, 8)],
              ["Region", agent.fly_region],
              ["Volume", agent.fly_volume_name],
            ] as [string, string | null | undefined][]).map(([label, value]) => (
              <div key={label} className="bg-slate-50 rounded-md px-2.5 py-2">
                <p className="text-slate-400 font-medium">{label}</p>
                <p className="text-slate-700 font-mono mt-0.5 truncate">{value ?? "—"}</p>
              </div>
            ))}
          </div>
          {agent.last_error && (
            <pre className="text-xs bg-red-50 text-red-600 rounded-md px-3 py-2 overflow-x-auto whitespace-pre-wrap mt-3">{agent.last_error}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Modal trigger (self-contained, lives in the header) ───────────────────────

type ModalKind = "workspace" | "agent";

function AgentModalTrigger({
  label,
  variant,
  modal,
  workspace,
  workspaces,
  workspaceName,
  agentName,
  agentKind,
  busy,
  onWorkspaceNameChange,
  onAgentNameChange,
  onAgentKindChange,
  onCreateWorkspace,
  onCreateAgent,
  onSelectWorkspace,
}: {
  label: string;
  variant: "outline" | "primary";
  modal: ModalKind;
  workspace: Workspace | null;
  workspaces: Workspace[];
  workspaceName: string;
  agentName: string;
  agentKind: AgentKind;
  busy: string | null;
  onWorkspaceNameChange: (v: string) => void;
  onAgentNameChange: (v: string) => void;
  onAgentKindChange: (v: AgentKind) => void;
  onCreateWorkspace: () => void;
  onCreateAgent: () => void;
  onSelectWorkspace: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const creating = useRef(false);

  useEffect(() => {
    if (creating.current && busy !== "agent") {
      creating.current = false;
      setOpen(false);
    }
  }, [busy]);

  function handleCreateWorkspace() {
    onCreateWorkspace();
    setOpen(false);
  }

  function handleCreateAgent() {
    creating.current = true;
    onCreateAgent();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          variant === "primary"
            ? "bg-slate-800 text-white hover:bg-slate-700"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        )}
      >
        <Plus className="h-3 w-3" />
        {label}
      </button>

      {modal === "workspace" && (
        <Modal open={open} onOpenChange={setOpen} title="New Workspace" description="Workspaces group related agents together.">
          <div className="space-y-4">
            <Field label="Name">
              <Input
                value={workspaceName}
                onChange={(e) => onWorkspaceNameChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace()}
                autoFocus
              />
            </Field>
            {workspaces.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-400 mb-2">Existing workspaces</p>
                <div className="flex flex-wrap gap-2">
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      onClick={() => { onSelectWorkspace(ws.id); setOpen(false); }}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                        ws.id === workspace?.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                      )}
                    >
                      {ws.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button onClick={handleCreateWorkspace} disabled={Boolean(busy)} loading={busy === "workspace"}>
              Create workspace
            </Button>
          </div>
        </Modal>
      )}

      {modal === "agent" && (
        <Modal
          open={open}
          onOpenChange={(v) => { if (!creating.current) setOpen(v); }}
          title="New Agent"
          description={workspace ? `Adding to "${workspace.name}"` : "Select a workspace first."}
          dismissable={busy !== "agent"}
        >
          <div className="space-y-4">
            <Field label="Name">
              <Input value={agentName} onChange={(e) => onAgentNameChange(e.target.value)} autoFocus />
            </Field>
            <Field label="Kind">
              <select
                value={agentKind}
                onChange={(e) => onAgentKindChange(e.target.value as AgentKind)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {AGENT_KINDS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            {!workspace && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2">
                Select a workspace before creating an agent.
              </p>
            )}
            {busy === "agent" && (
              <p className="text-xs text-blue-600 bg-blue-50 rounded-md px-3 py-2">
                Provisioning Fly Machine — this takes about 30 seconds…
              </p>
            )}
            <Button onClick={handleCreateAgent} disabled={!workspace || Boolean(busy)} loading={busy === "agent"}>
              Create agent
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}



// ── Shared primitives ─────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500",
        props.className
      )}
    />
  );
}

function Button({
  children,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className="w-full inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

function IconButton({
  icon: Icon,
  label,
  spin,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ElementType;
  label: string;
  spin?: boolean;
}) {
  return (
    <button
      {...props}
      title={label}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      <Icon className={cn("h-3 w-3", spin && "animate-spin")} />
      {label}
    </button>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <Icon className="h-8 w-8 text-slate-300 mb-3" />
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="text-xs text-slate-400 mt-1">{description}</p>
    </div>
  );
}


function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-700">{value}</span>
    </div>
  );
}

// ── Usage view ────────────────────────────────────────────────────────────────

function UsageView({ usage, loading, onRefresh }: { usage: UserUsage | null; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">My Usage</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {!usage && !loading && (
        <EmptyState icon={BarChart2} title="No usage data" description="Click Refresh to load your usage." />
      )}
      {usage && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Compute (Fly.io)</h3>
              <div className="space-y-1.5">
                <CostRow label="Total uptime" value={formatUptime(usage.uptime.uptime_seconds)} />
                <CostRow label="Agents created" value={String(usage.uptime.agent_count)} />
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">AI (OpenRouter)</h3>
              {!usage.openrouter ? (
                <p className="text-xs text-slate-400">No OpenRouter key provisioned yet. Create an agent to get started.</p>
              ) : (
                <div className="space-y-1.5">
                  <CostRow label="Spent" value={`$${usage.openrouter.usage.toFixed(4)}`} />
                  {usage.openrouter.limit != null && (
                    <CostRow label="Limit" value={`$${usage.openrouter.limit.toFixed(2)}`} />
                  )}
                  {usage.openrouter.limit_remaining != null && (
                    <CostRow label="Remaining" value={`$${usage.openrouter.limit_remaining.toFixed(4)}`} />
                  )}
                </div>
              )}
            </div>
          </div>
          {usage.models.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">AI Usage by Model <span className="font-normal text-slate-400">(last 30 days)</span></h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-1.5 pr-4 font-medium text-slate-500">Model</th>
                      <th className="text-right py-1.5 pr-4 font-medium text-slate-500">Reqs</th>
                      <th className="text-right py-1.5 pr-4 font-medium text-slate-500">Input</th>
                      <th className="text-right py-1.5 pr-4 font-medium text-slate-500">Output</th>
                      <th className="text-right py-1.5 font-medium text-slate-500">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.models.map((m) => (
                      <tr key={m.model} className="border-b border-slate-50 last:border-0">
                        <td className="py-1.5 pr-4 font-mono text-slate-700">{m.model}</td>
                        <td className="py-1.5 pr-4 text-right text-slate-600">{m.requests.toLocaleString()}</td>
                        <td className="py-1.5 pr-4 text-right text-slate-600">{m.prompt_tokens.toLocaleString()}</td>
                        <td className="py-1.5 pr-4 text-right text-slate-600">{m.completion_tokens.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-slate-600">${m.cost.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Connections view ──────────────────────────────────────────────────────────

function ConnectionsView({
  connections,
  connectionsLoading,
  searchQuery,
  searchResults,
  searchLoading,
  connectingApp,
  onSearchChange,
  onConnect,
  onDisconnect,
  onRefreshConnections,
}: {
  connections: ComposioConnection[];
  connectionsLoading: boolean;
  searchQuery: string;
  searchResults: ComposioSearchResult[];
  searchLoading: boolean;
  connectingApp: string | null;
  onSearchChange: (q: string) => void;
  onConnect: (toolkitSlug: string) => void;
  onDisconnect: (connectionId: string) => void;
  onRefreshConnections: () => void;
}) {
  const connectedSlugs = new Set(connections.map((c) => c.toolkit));

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Connections</h2>
          <p className="text-xs text-slate-400 mt-0.5">Connect apps to make them available in your agents via Composio</p>
        </div>
        <button
          onClick={onRefreshConnections}
          disabled={connectionsLoading}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors shrink-0"
        >
          <RefreshCw className={cn("h-3 w-3", connectionsLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search all Composio integrations…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {searchLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
        )}
      </div>

      {/* Results grid */}
      {searchResults.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {searchResults.map((tk) => {
            const conn = connections.find((c) => c.toolkit === tk.slug);
            const isConnected = connectedSlugs.has(tk.slug);
            const isConnecting = connectingApp === tk.slug;
            return (
              <div
                key={tk.slug}
                className={cn(
                  "relative flex flex-col rounded-xl border p-4 transition-all",
                  isConnected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                )}
              >
                {/* Logo + name */}
                <div className="flex items-center gap-2.5 mb-3">
                  {tk.logo ? (
                    <img src={tk.logo} alt={tk.name} className="h-6 w-6 rounded object-contain shrink-0" />
                  ) : (
                    <div className="h-6 w-6 rounded bg-slate-100 flex items-center justify-center shrink-0">
                      <Plug className="h-3 w-3 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{tk.name}</p>
                    {tk.toolsCount > 0 && (
                      <p className="text-xs text-slate-400">{tk.toolsCount} tools</p>
                    )}
                  </div>
                  {isConnected && (
                    <Plug className="h-3 w-3 text-emerald-500 shrink-0 ml-auto" />
                  )}
                </div>

                {/* Description */}
                {tk.description && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3 flex-1">{tk.description}</p>
                )}

                {/* Action */}
                {isConnected ? (
                  <button
                    onClick={() => conn && onDisconnect(conn.id)}
                    className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Unplug className="h-3 w-3" />
                    Disconnect
                  </button>
                ) : tk.composioManaged ? (
                  <button
                    onClick={() => onConnect(tk.slug)}
                    disabled={isConnecting}
                    className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
                  >
                    {isConnecting ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3 w-3" />
                    )}
                    {isConnecting ? "Opening…" : "Connect"}
                  </button>
                ) : (
                  <span className="mt-auto inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 text-slate-400">
                    Custom setup
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!searchLoading && searchResults.length === 0 && (
        searchQuery.length > 0 && searchQuery.length < 3
          ? <EmptyState icon={Search} title="Keep typing…" description="Enter at least 3 characters to search" />
          : searchQuery.length >= 3
            ? <EmptyState icon={Search} title="No results" description={`No integrations found for "${searchQuery}"`} />
            : <EmptyState icon={Search} title="Search integrations" description="Type above to search 200+ app integrations available via Composio" />
      )}
    </div>
  );
}

// ── Admin view ────────────────────────────────────────────────────────────────

const FLY_STATE_DOT: Record<string, string> = {
  started: "bg-emerald-400",
  suspended: "bg-slate-400",
  stopping: "bg-yellow-400",
  stopped: "bg-slate-300",
  creating: "bg-purple-400",
  destroying: "bg-red-400",
};

function AdminView({
  usage, loading, onRefresh,
  machines, machinesLoading, onRefreshMachines,
}: {
  usage: AdminUsage | null; loading: boolean; onRefresh: () => void;
  machines: FlyMachine[] | null; machinesLoading: boolean; onRefreshMachines: () => void;
}) {
  const [stateFilter, setStateFilter] = useState<string>("all");

  const allStates = machines
    ? Array.from(new Set(machines.map((m) => m.state))).sort()
    : [];

  const visibleMachines = machines
    ? (stateFilter === "all" ? machines : machines.filter((m) => m.state === stateFilter))
    : null;

  return (
    <div className="space-y-8">
      {/* Fly Machines */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Fly Machines</h2>
          <div className="flex items-center gap-2">
            {machines && allStates.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setStateFilter("all")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    stateFilter === "all"
                      ? "bg-slate-800 text-white"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  All ({machines.length})
                </button>
                {allStates.map((s) => {
                  const count = machines.filter((m) => m.state === s).length;
                  return (
                    <button
                      key={s}
                      onClick={() => setStateFilter(s)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        stateFilter === s
                          ? "bg-slate-800 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", FLY_STATE_DOT[s] ?? "bg-slate-400")} />
                      {s} ({count})
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={onRefreshMachines}
              disabled={machinesLoading}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className={cn("h-3 w-3", machinesLoading && "animate-spin")} />
              {machinesLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
        {!machines && !machinesLoading && (
          <EmptyState icon={ShieldCheck} title="No data" description="Click Refresh to load Fly machines." />
        )}
        {machines && machines.length === 0 && (
          <EmptyState icon={ShieldCheck} title="No machines" description="No Fly machines found in your organization." />
        )}
        {visibleMachines && visibleMachines.length === 0 && machines && machines.length > 0 && (
          <EmptyState icon={ShieldCheck} title="No machines" description={`No machines with state "${stateFilter}".`} />
        )}
        {visibleMachines && visibleMachines.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
                  <th className="px-4 py-3">App</th>
                  <th className="px-4 py-3">Machine ID</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Region</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Image</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {visibleMachines.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800 font-mono text-xs">{m.appName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.id}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
                        <span className={cn("h-1.5 w-1.5 rounded-full", FLY_STATE_DOT[m.state] ?? "bg-slate-400")} />
                        {m.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{m.region}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{new Date(m.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400 truncate max-w-[200px]" title={m.image ?? ""}>{m.image?.split(":")[0].split("/").at(-1) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Users */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">All Users</h2>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {!usage && !loading && (
          <EmptyState icon={ShieldCheck} title="No data" description="Click Refresh to load user usage." />
        )}
        {usage && usage.users.length === 0 && (
          <EmptyState icon={ShieldCheck} title="No users yet" description="Users appear here once they have created an agent." />
        )}
        {usage && usage.users.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Agents</th>
                  <th className="px-4 py-3">Uptime</th>
                  <th className="px-4 py-3">OR Spend</th>
                  <th className="px-4 py-3">OR Remaining</th>
                  <th className="px-4 py-3">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {usage.users.map((u) => (
                  <tr key={u.userId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[180px]">{u.email ?? "—"}</p>
                      <p className="font-mono text-xs text-slate-400">{u.userId.slice(0, 8)}…</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{u.uptime.agent_count}</td>
                    <td className="px-4 py-3 text-slate-600">{formatUptime(u.uptime.uptime_seconds)}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {u.openrouter ? `$${u.openrouter.usage.toFixed(4)}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {u.openrouter?.limit_remaining != null ? `$${u.openrouter.limit_remaining.toFixed(4)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {u.isAdmin && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700">
                          admin
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const TOOLKIT_NAMES: Record<string, string> = {
  gmail: "Gmail",
  github: "GitHub",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  linear: "Linear",
  notion: "Notion",
  slack: "Slack",
  confluence: "Confluence",
  jira: "Jira",
};

function formatToolkitName(slug: string): string {
  return TOOLKIT_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── API helper ────────────────────────────────────────────────────────────────

function LoginPage() {
  const [loading, setLoading] = useState<"google" | "github" | null>(null);

  async function signIn(provider: "google" | "github") {
    setLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm px-8 py-10 rounded-2xl bg-slate-800 border border-slate-700 shadow-2xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-2">AtlasLives</p>
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to manage your agents</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => void signIn("github")}
            disabled={Boolean(loading)}
            className="w-full flex items-center justify-center gap-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
            {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
          </button>
          <button
            onClick={() => void signIn("google")}
            disabled={Boolean(loading)}
            className="w-full flex items-center justify-center gap-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {loading === "google" ? "Redirecting…" : "Continue with Google"}
          </button>
        </div>
      </div>
    </div>
  );
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (options.body) headers["Content-Type"] = "application/json";
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(parsed?.error ?? parsed?.message ?? `Request failed with ${response.status}`);
  return parsed;
}
