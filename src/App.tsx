import { useEffect, useRef, useState } from "react";
import { supabase, type Agent as SbAgent, type Message } from "./supabase";
import { cn } from "./lib/utils";
import { Modal } from "./components/ui/modal";
import {
  Bot,
  MessageSquare,
  LayoutGrid,
  DollarSign,
  ChevronRight,
  Terminal,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Send,
  Circle,
  Plus,
} from "lucide-react";

type NavItem = "agents" | "messages" | "registry" | "costs";

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

type Costs = {
  openrouter: { label: string; plan: string; usage_daily: number; usage_monthly: number; usage_total: number; limit: number; limit_remaining: number; error?: string };
  fly: { label: string; plan: string; apps: number; machines_total: number; machines_by_state: Record<string, number>; est_hourly_usd: number; error?: string };
  vercel: { label: string; plan: string; status: string; monthly_usd: number | null; error?: string };
  supabase: { label: string; plan: string; status: string; region: string; monthly_usd: number; error?: string };
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
  { id: "messages", label: "Messages", icon: MessageSquare },
  { id: "registry", label: "Registry", icon: LayoutGrid },
  { id: "costs", label: "Costs", icon: DollarSign },
];

export default function App() {
  const [nav, setNav] = useState<NavItem>("agents");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [loadedAgentIds, setLoadedAgentIds] = useState<Set<string>>(new Set());
  const [workspaceName, setWorkspaceName] = useState("Demo Workspace");
  const [agentName, setAgentName] = useState("Shell Agent");
  const [agentKind, setAgentKind] = useState<"shell-agent" | "opencode-agent" | "claude-agent" | "pi-agent">("shell-agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [sbAgents, setSbAgents] = useState<SbAgent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [msgPayload, setMsgPayload] = useState("");
  const [sending, setSending] = useState(false);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [costsLoading, setCostsLoading] = useState(false);

  useEffect(() => {
    void loadInitialState();
    void loadSbAgents();
    void loadMessages();

    const agentSub = supabase
      .channel("agents")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => void loadSbAgents())
      .subscribe();

    const msgSub = supabase
      .channel("messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => void loadMessages())
      .subscribe();

    return () => {
      void supabase.removeChannel(agentSub);
      void supabase.removeChannel(msgSub);
    };
  }, []);

  async function loadSbAgents() {
    const { data } = await supabase.from("agents").select("*").order("created_at", { ascending: false });
    if (data) setSbAgents(data as SbAgent[]);
  }

  async function loadMessages() {
    const { data } = await supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(10);
    if (data) setMessages(data as Message[]);
  }

  async function sendMessage() {
    if (!selectedRecipient || !msgPayload.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        to_agent_id: selectedRecipient,
        payload: msgPayload.trim(),
        status: "pending",
      });
      if (error) throw error;
      setMsgPayload("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function loadInitialState() {
    const [healthRes, wsRes] = await Promise.all([
      api<{ ok: boolean }>("/api/health"),
      api<{ workspaces: Workspace[] }>("/api/workspaces"),
    ]);
    void healthRes;
    setWorkspaces(wsRes.workspaces);
    if (wsRes.workspaces[0]) await loadWorkspace(wsRes.workspaces[0].id);
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
      setSelectedAgent(data.agent);
    });
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

  async function loadCosts() {
    setCostsLoading(true);
    try {
      const data = await api<Costs>("/api/costs");
      setCosts(data);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setCostsLoading(false);
    }
  }

  useEffect(() => {
    if (nav === "costs") void loadCosts();
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
    setNav("agents");
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col bg-slate-900 text-slate-100 overflow-y-auto">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-slate-800">
          <p className="text-sm font-semibold tracking-wide text-slate-300 uppercase">AtlasLives</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{workspace?.name ?? "No workspace"}</p>
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
            {agents.length > 0 && (
              <span className="ml-auto text-xs bg-slate-600 text-slate-200 rounded-full px-1.5 py-0.5 leading-none">
                {agents.length}
              </span>
            )}
          </button>

          {/* Agent list — always visible when agents exist */}
          {agents.length > 0 && (
            <div className="pb-1 space-y-0.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => selectAgent(agent)}
                  className={cn(
                    "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    selectedAgent?.id === agent.id && nav === "agents"
                      ? "bg-slate-600 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[agent.status] ?? "bg-slate-400")} />
                  <span className="truncate">{agent.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Other nav items */}
          {([
            { id: "messages" as NavItem, label: "Messages", icon: MessageSquare },
            { id: "registry" as NavItem, label: "Registry", icon: LayoutGrid },
            { id: "costs" as NavItem, label: "Costs", icon: DollarSign },
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
              {id === "registry" && sbAgents.length > 0 && (
                <span className="ml-auto text-xs bg-slate-600 text-slate-200 rounded-full px-1.5 py-0.5 leading-none">
                  {sbAgents.length}
                </span>
              )}
              {id === "messages" && messages.filter((m) => m.status === "processing").length > 0 && (
                <span className="ml-auto flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Workspace switcher */}
        <div className="px-3 pb-4 border-t border-slate-800 pt-3">
          <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Workspaces</p>
          <div className="space-y-0.5">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => void loadWorkspace(ws.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium truncate transition-colors",
                  ws.id === workspace?.id
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                )}
              >
                <ChevronRight className="h-3 w-3 shrink-0" />
                <span className="truncate">{ws.name}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
                      onAgentKindChange={setAgentKind}
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
                      onAgentKindChange={setAgentKind}
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
              "border-0 w-full",
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
            <AgentListView agents={agents} workspace={workspace} onSelect={selectAgent} />
          )}
          {nav === "messages" && (
            <MessagesView
              sbAgents={sbAgents}
              messages={messages}
              selectedRecipient={selectedRecipient}
              msgPayload={msgPayload}
              sending={sending}
              onRecipientChange={setSelectedRecipient}
              onPayloadChange={setMsgPayload}
              onSend={sendMessage}
            />
          )}
          {nav === "registry" && <RegistryView agents={sbAgents} />}
          {nav === "costs" && (
            <CostsView costs={costs} loading={costsLoading} onRefresh={loadCosts} />
          )}
        </main>
      </div>
    </div>
  );
}

// ── Agent list (shown when no agent selected) ─────────────────────────────────

function AgentListView({
  agents,
  workspace,
  onSelect,
}: {
  agents: Agent[];
  workspace: Workspace | null;
  onSelect: (a: Agent) => void;
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
        <button
          key={agent.id}
          onClick={() => onSelect(agent)}
          className="w-full text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 hover:shadow-sm transition-all"
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
        </button>
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
  agentKind: "shell-agent" | "opencode-agent" | "claude-agent" | "pi-agent";
  busy: string | null;
  onWorkspaceNameChange: (v: string) => void;
  onAgentNameChange: (v: string) => void;
  onAgentKindChange: (v: "shell-agent" | "opencode-agent" | "claude-agent" | "pi-agent") => void;
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
                onChange={(e) => onAgentKindChange(e.target.value as "shell-agent" | "opencode-agent" | "claude-agent" | "pi-agent")}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="shell-agent">shell-agent — bash</option>
                <option value="opencode-agent">opencode-agent — Gemini 2.5 Flash</option>
                <option value="claude-agent">claude-agent — Claude via OpenRouter</option>
                <option value="pi-agent">pi-agent — pi.dev via OpenRouter</option>
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

function MessagesView({
  sbAgents,
  messages,
  selectedRecipient,
  msgPayload,
  sending,
  onRecipientChange,
  onPayloadChange,
  onSend,
}: {
  sbAgents: SbAgent[];
  messages: Message[];
  selectedRecipient: string;
  msgPayload: string;
  sending: boolean;
  onRecipientChange: (v: string) => void;
  onPayloadChange: (v: string) => void;
  onSend: () => void;
}) {
  const recipient = sbAgents.find((a) => a.id === selectedRecipient);
  return (
    <div className="space-y-4">
      {/* Compose */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">New Message</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <Field label="Recipient">
              <select
                value={selectedRecipient}
                onChange={(e) => onRecipientChange(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— select agent —</option>
                {sbAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fly_app_name} ({a.kind})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Payload">
              <textarea
                value={msgPayload}
                onChange={(e) => onPayloadChange(e.target.value)}
                placeholder={
                  recipient?.kind === "claude-agent"
                    ? "Ask Claude something..."
                    : "Shell command, e.g. echo hello && date"
                }
                rows={2}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            disabled={sending || !selectedRecipient || !msgPayload.trim()}
            onClick={onSend}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {/* Message log */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Message History</h2>
        {messages.length === 0 ? (
          <EmptyState icon={MessageSquare} title="No messages yet" description="Send a message to an agent above." />
        ) : (
          <div className="space-y-3">
            {messages.map((m) => {
              const to = sbAgents.find((a) => a.id === m.to_agent_id);
              return (
                <div key={m.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">→ {to?.fly_app_name ?? m.to_agent_id.slice(0, 8)}</span>
                    <StatusBadge status={m.status} />
                    <span className="ml-auto">{new Date(m.created_at).toLocaleTimeString()}</span>
                  </div>
                  <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words font-mono">{m.payload}</pre>
                  {(m.result || m.status === "processing") && (
                    <pre className="text-xs text-emerald-300 bg-slate-900 rounded-md px-3 py-2 whitespace-pre-wrap break-words font-mono overflow-x-auto">
                      {m.result ?? ""}
                      {m.status === "processing" && (
                        <span style={{ animation: "blink 1s step-end infinite" }}>▋</span>
                      )}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RegistryView({ agents }: { agents: SbAgent[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Live Registry</h2>
        <span className="text-xs text-slate-400">{agents.length} agent{agents.length !== 1 ? "s" : ""}</span>
      </div>
      {agents.length === 0 ? (
        <div className="p-6">
          <EmptyState icon={LayoutGrid} title="No agents registered" description="Agents appear here when they boot and register with Supabase." />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
              <th className="px-4 py-3">App</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Region</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {agents.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-800">{a.fly_app_name}</td>
                <td className="px-4 py-3 text-slate-500">{a.kind}</td>
                <td className="px-4 py-3 text-slate-500">{a.fly_region ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{a.id.slice(0, 8)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CostsView({ costs, loading, onRefresh }: { costs: Costs | null; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Service Costs</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!costs && !loading && (
        <EmptyState icon={DollarSign} title="No cost data yet" description="Click Refresh to fetch live cost data from all services." />
      )}

      {costs && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CostCard title="OpenRouter" plan={costs.openrouter.plan} error={costs.openrouter.error}>
            <CostRow label="Today" value={`$${costs.openrouter.usage_daily?.toFixed(4)}`} />
            <CostRow label="This month" value={`$${costs.openrouter.usage_monthly?.toFixed(4)}`} />
            <CostRow label="Total" value={`$${costs.openrouter.usage_total?.toFixed(4)}`} />
            <CostRow label="Limit remaining" value={`$${costs.openrouter.limit_remaining?.toFixed(4)}`} />
          </CostCard>
          <CostCard title="Fly.io" plan={costs.fly.plan} error={costs.fly.error}>
            <CostRow label="Apps" value={String(costs.fly.apps)} />
            <CostRow label="Total machines" value={String(costs.fly.machines_total)} />
            <CostRow label="Running now" value={String(costs.fly.machines_by_state?.started ?? 0)} />
            <CostRow label="Est. cost/hr" value={`$${costs.fly.est_hourly_usd?.toFixed(5)}`} />
          </CostCard>
          <CostCard title="Vercel" plan={costs.vercel.plan} error={costs.vercel.error}>
            <CostRow label="Status" value={costs.vercel.status} />
            <CostRow label="Monthly" value={costs.vercel.monthly_usd != null ? `$${costs.vercel.monthly_usd.toFixed(2)}` : "—"} />
          </CostCard>
          <CostCard title="Supabase" plan={costs.supabase.plan} error={costs.supabase.error}>
            <CostRow label="Status" value={costs.supabase.status} />
            <CostRow label="Region" value={costs.supabase.region} />
            <CostRow label="Monthly" value={`$${costs.supabase.monthly_usd?.toFixed(2)}`} />
          </CostCard>
        </div>
      )}
    </div>
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

function CostCard({
  title,
  plan,
  error,
  children,
}: {
  title: string;
  plan: string;
  error?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-xs text-slate-400">{plan}</span>
      </div>
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
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

// ── API helper ────────────────────────────────────────────────────────────────

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(parsed?.error ?? parsed?.message ?? `Request failed with ${response.status}`);
  return parsed;
}
