import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, type Agent as SbAgent, type Message } from "./supabase";

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

type Health = {
  ok: boolean;
  config: {
    flyConfigured: boolean;
    runtimeImageConfigured: boolean;
    flyOrgSlug: string;
    defaultRegion: string;
  };
};

type Costs = {
  openrouter: { label: string; plan: string; usage_daily: number; usage_monthly: number; usage_total: number; limit: number; limit_remaining: number; error?: string };
  fly: { label: string; plan: string; apps: number; machines_total: number; machines_by_state: Record<string, number>; est_hourly_usd: number; error?: string };
  vercel: { label: string; plan: string; status: string; monthly_usd: number | null; error?: string };
  supabase: { label: string; plan: string; status: string; region: string; monthly_usd: number; error?: string };
};

const statusLabels: Record<string, string> = {
  creating: "Creating",
  running: "Running",
  suspending: "Suspending",
  suspended: "Suspended",
  resuming: "Resuming",
  error: "Error"
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [workspaceName, setWorkspaceName] = useState("Demo Workspace");
  const [agentName, setAgentName] = useState("Shell Agent");
  const [agentKind, setAgentKind] = useState<"shell-agent" | "opencode-agent" | "claude-agent">("shell-agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Agent-to-agent comms state
  const [sbAgents, setSbAgents] = useState<SbAgent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [msgPayload, setMsgPayload] = useState("");
  const [sending, setSending] = useState(false);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [costsLoading, setCostsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const canCreateAgent = Boolean(workspace && !busy);

  useEffect(() => {
    void loadInitialState();
    void loadSbAgents();
    void loadMessages();

    // Realtime: agents
    const agentSub = supabase
      .channel("agents")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => {
        void loadSbAgents();
      })
      .subscribe();

    // Realtime: messages
    const msgSub = supabase
      .channel("messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void loadMessages();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(agentSub);
      void supabase.removeChannel(msgSub);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadSbAgents() {
    const { data } = await supabase.from("agents").select("*").order("created_at", { ascending: false });
    if (data) setSbAgents(data as SbAgent[]);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(50);
    if (data) setMessages(data as Message[]);
  }

  async function sendMessage() {
    if (!selectedRecipient || !msgPayload.trim()) return;
    setSending(true);
    try {
      const { error } = await supabase.from("messages").insert({
        to_agent_id: selectedRecipient,
        payload: msgPayload.trim(),
        status: "pending"
      });
      if (error) throw error;
      setMsgPayload("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function loadInitialState() {
    const [healthResponse, workspacesResponse] = await Promise.all([
      api<{ ok: boolean; config: Health["config"] }>("/api/health"),
      api<{ workspaces: Workspace[] }>("/api/workspaces")
    ]);

    setHealth(healthResponse);
    setWorkspaces(workspacesResponse.workspaces);

    const first = workspacesResponse.workspaces[0];
    if (first) {
      await loadWorkspace(first.id);
    }
  }

  async function loadWorkspace(workspaceId: string) {
    const data = await api<{ workspace: Workspace; agents: Agent[] }>(`/api/workspaces/${workspaceId}`);
    setWorkspace(data.workspace);
    setAgents(data.agents);
  }

  async function createWorkspace() {
    await run("workspace", async () => {
      const data = await api<{ workspace: Workspace }>("/api/workspaces", {
        method: "POST",
        body: { name: workspaceName }
      });
      setWorkspace(data.workspace);
      setAgents([]);
      setWorkspaces([data.workspace, ...workspaces]);
      setMessage("Workspace created.");
    });
  }

  async function createAgent() {
    if (!workspace) return;
    await run("agent", async () => {
      const data = await api<{ agent: Agent }>(`/api/workspaces/${workspace.id}/agents`, {
        method: "POST",
        body: { name: agentName, kind: agentKind }
      });
      setAgents([data.agent, ...agents]);
      setMessage(data.agent.status === "running" ? "Agent is running." : "Agent creation finished with an error.");
    });
  }

  async function refreshAgent(agent: Agent) {
    await run(`refresh-${agent.id}`, async () => {
      const data = await api<{ agent: Agent }>(`/api/agents/${agent.id}/refresh`, { method: "POST" });
      replaceAgent(data.agent);
      setMessage("Status refreshed.");
    });
  }

  async function suspendAgent(agent: Agent) {
    await run(`suspend-${agent.id}`, async () => {
      const data = await api<{ agent: Agent }>(`/api/agents/${agent.id}/suspend`, { method: "POST" });
      replaceAgent(data.agent);
      setMessage("Suspend request completed.");
    });
  }

  async function resumeAgent(agent: Agent) {
    await run(`resume-${agent.id}`, async () => {
      const data = await api<{ agent: Agent }>(`/api/agents/${agent.id}/resume`, { method: "POST" });
      replaceAgent(data.agent);
      setMessage("Resume request completed.");
    });
  }

  async function loadCosts() {
    setCostsLoading(true);
    try {
      const data = await api<Costs>("/api/costs");
      setCosts(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setCostsLoading(false);
    }
  }

  function replaceAgent(agent: Agent) {
    setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const configItems = useMemo(() => {
    if (!health) return [];
    return [
      ["Fly", health.config.flyConfigured ? "Configured" : "Missing token"],
      ["Runtime image", health.config.runtimeImageConfigured ? "Configured" : "Missing FLY_RUNTIME_IMAGE"],
      ["Org", health.config.flyOrgSlug],
      ["Region", health.config.defaultRegion]
    ];
  }, [health]);

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <h1>AtlasLives Spike</h1>
          <p>Minimal proof for persistent browser terminals on Fly Machines.</p>
        </div>
        <div className="env-grid">
          {configItems.map(([label, value]) => (
            <div className="env-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="layout">
        <div className="panel">
          <div className="panel-heading">
            <h2>Workspace</h2>
          </div>
          <label>
            Name
            <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
          </label>
          <button disabled={Boolean(busy)} onClick={createWorkspace}>
            {busy === "workspace" ? "Creating..." : "Create workspace"}
          </button>
          {workspaces.length ? (
            <div className="workspace-list">
              {workspaces.map((item) => (
                <button
                  className={item.id === workspace?.id ? "selected" : ""}
                  key={item.id}
                  onClick={() => loadWorkspace(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>Agent</h2>
            <span>{agentKind}</span>
          </div>
          <label>
            Name
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} />
          </label>
          <label>
            Kind
            <select value={agentKind} onChange={(event) => setAgentKind(event.target.value as "shell-agent" | "opencode-agent" | "claude-agent")}>
              <option value="shell-agent">shell-agent</option>
              <option value="opencode-agent">opencode-agent (Gemini 2.5 Flash)</option>
              <option value="claude-agent">claude-agent (Claude via OpenRouter)</option>
            </select>
          </label>
          <button disabled={!canCreateAgent} onClick={createAgent}>
            {busy === "agent" ? "Creating..." : "Create agent"}
          </button>
          {!workspace ? <p className="muted">Create or select a workspace first.</p> : null}
        </div>
      </section>

      <section className="agent-surface">
        <div className="panel-heading">
          <h2>Agents</h2>
          {workspace ? <span className="muted">{agents.length} in workspace</span> : null}
        </div>

        {agents.length === 0 ? (
          <p className="muted">{workspace ? "No agents yet — create one above." : "Select a workspace first."}</p>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} style={{ marginBottom: "20px", padding: "16px", border: "1px solid #2a2a2a", borderRadius: "6px" }}>
              <div className="panel-heading" style={{ marginBottom: "12px" }}>
                <strong>{agent.name}</strong>
                <span className={`status status-${agent.status}`}>{statusLabels[agent.status] || agent.status}</span>
              </div>

              <dl className="facts">
                <div><dt>Fly app</dt><dd>{agent.fly_app_name || "Pending"}</dd></div>
                <div><dt>Machine</dt><dd>{agent.fly_machine_id || "Pending"}</dd></div>
                <div><dt>Region</dt><dd>{agent.fly_region || "Pending"}</dd></div>
                <div><dt>Kind</dt><dd>{agent.kind}</dd></div>
              </dl>

              {agent.last_error ? <pre className="error-box">{agent.last_error}</pre> : null}

              <div className="actions">
                <button disabled={Boolean(busy)} onClick={() => refreshAgent(agent)}>Refresh</button>
                <button disabled={Boolean(busy) || !agent.fly_machine_id} onClick={() => suspendAgent(agent)}>Suspend</button>
                <button disabled={Boolean(busy) || !agent.fly_machine_id} onClick={() => resumeAgent(agent)}>Resume</button>
                <a
                  className={agent.terminal_url ? "button-link" : "button-link disabled"}
                  href={agent.terminal_url || undefined}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open terminal
                </a>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="agent-surface">
        <div className="panel-heading">
          <h2>Agent Registry</h2>
          <span className="muted">{sbAgents.length} registered</span>
        </div>
        {sbAgents.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
                <th style={{ padding: "4px 8px" }}>App</th>
                <th style={{ padding: "4px 8px" }}>Kind</th>
                <th style={{ padding: "4px 8px" }}>Region</th>
                <th style={{ padding: "4px 8px" }}>Status</th>
                <th style={{ padding: "4px 8px" }}>ID</th>
              </tr>
            </thead>
            <tbody>
              {sbAgents.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "4px 8px" }}>{a.fly_app_name}</td>
                  <td style={{ padding: "4px 8px" }}>{a.kind}</td>
                  <td style={{ padding: "4px 8px" }}>{a.fly_region || "—"}</td>
                  <td style={{ padding: "4px 8px" }}>
                    <span className={`status status-${a.status}`}>{a.status}</span>
                  </td>
                  <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: "0.75rem" }}>{a.id.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No agents registered yet. Agents appear here when they boot and register with Supabase.</p>
        )}
      </section>

      <section className="agent-surface">
        <div className="panel-heading">
          <h2>Costs</h2>
          <button onClick={loadCosts} disabled={costsLoading} style={{ fontSize: "0.8rem" }}>
            {costsLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {!costs && !costsLoading ? (
          <p className="muted">Click Refresh to fetch live cost data from all services.</p>
        ) : costsLoading ? (
          <p className="muted">Fetching…</p>
        ) : costs ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
            {/* OpenRouter */}
            <div style={{ padding: "12px", border: "1px solid #2a2a2a", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>OpenRouter <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{costs.openrouter.plan}</span></div>
              {costs.openrouter.error ? <p className="muted">{costs.openrouter.error}</p> : (
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr><td className="muted">Today</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.openrouter.usage_daily?.toFixed(4)}</td></tr>
                    <tr><td className="muted">This month</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.openrouter.usage_monthly?.toFixed(4)}</td></tr>
                    <tr><td className="muted">Total</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.openrouter.usage_total?.toFixed(4)}</td></tr>
                    <tr><td className="muted">Limit</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.openrouter.limit?.toFixed(2)}</td></tr>
                    <tr><td className="muted">Remaining</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.openrouter.limit_remaining?.toFixed(4)}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
            {/* Fly.io */}
            <div style={{ padding: "12px", border: "1px solid #2a2a2a", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Fly.io <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{costs.fly.plan}</span></div>
              {costs.fly.error ? <p className="muted">{costs.fly.error}</p> : (
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr><td className="muted">Apps</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{costs.fly.apps}</td></tr>
                    <tr><td className="muted">Machines</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{costs.fly.machines_total}</td></tr>
                    <tr><td className="muted">Running now</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{costs.fly.machines_by_state?.started || 0}</td></tr>
                    <tr><td className="muted">Est. cost</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.fly.est_hourly_usd?.toFixed(5)}/hr</td></tr>
                  </tbody>
                </table>
              )}
              <p className="muted" style={{ fontSize: "0.75rem", marginTop: "6px" }}>Actuals at fly.io/dashboard</p>
            </div>
            {/* Vercel */}
            <div style={{ padding: "12px", border: "1px solid #2a2a2a", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Vercel <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{costs.vercel.plan}</span></div>
              {costs.vercel.error ? <p className="muted">{costs.vercel.error}</p> : (
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr><td className="muted">Status</td><td style={{ textAlign: "right" }}>{costs.vercel.status}</td></tr>
                    <tr><td className="muted">Monthly</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{costs.vercel.monthly_usd != null ? `$${costs.vercel.monthly_usd.toFixed(2)}` : "—"}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
            {/* Supabase */}
            <div style={{ padding: "12px", border: "1px solid #2a2a2a", borderRadius: "6px" }}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Supabase <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{costs.supabase.plan}</span></div>
              {costs.supabase.error ? <p className="muted">{costs.supabase.error}</p> : (
                <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
                  <tbody>
                    <tr><td className="muted">Status</td><td style={{ textAlign: "right" }}>{costs.supabase.status}</td></tr>
                    <tr><td className="muted">Region</td><td style={{ textAlign: "right" }}>{costs.supabase.region}</td></tr>
                    <tr><td className="muted">Monthly</td><td style={{ textAlign: "right", fontFamily: "monospace" }}>${costs.supabase.monthly_usd?.toFixed(2)}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="agent-surface">
        <div className="panel-heading">
          <h2>Send Message</h2>
        </div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
          <select
            value={selectedRecipient}
            onChange={(e) => setSelectedRecipient(e.target.value)}
            style={{ flex: "1", minWidth: "200px" }}
          >
            <option value="">— select recipient agent —</option>
            {sbAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fly_app_name} ({a.kind})
              </option>
            ))}
          </select>
          <textarea
            value={msgPayload}
            onChange={(e) => setMsgPayload(e.target.value)}
            placeholder={selectedRecipient && sbAgents.find(a => a.id === selectedRecipient)?.kind === "claude-agent"
              ? "Ask Claude something..."
              : "Enter a shell command, e.g. echo hello && date"}
            rows={2}
            style={{ flex: "3", minWidth: "200px", resize: "vertical" }}
          />
          <button
            disabled={sending || !selectedRecipient || !msgPayload.trim()}
            onClick={sendMessage}
            style={{ alignSelf: "flex-end" }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>

        <div style={{ maxHeight: "320px", overflowY: "auto", border: "1px solid #222", borderRadius: "4px", padding: "8px" }}>
          {messages.length === 0 ? (
            <p className="muted">No messages yet.</p>
          ) : (
            messages.map((m) => {
              const recipient = sbAgents.find((a) => a.id === m.to_agent_id);
              return (
                <div key={m.id} style={{ marginBottom: "12px", borderBottom: "1px solid #1a1a1a", paddingBottom: "8px" }}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "baseline", fontSize: "0.8rem", color: "#666", marginBottom: "4px" }}>
                    <span>→ {recipient?.fly_app_name || m.to_agent_id.slice(0, 8)}</span>
                    <span className={`status status-${m.status}`}>{m.status}</span>
                    <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                  </div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.85rem" }}>{m.payload}</pre>
                  {m.result ? (
                    <pre style={{ margin: "6px 0 0", padding: "6px", background: "#111", borderRadius: "3px", whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "0.8rem", color: "#0f0" }}>
                      {m.result}
                    </pre>
                  ) : null}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </section>
    </main>
  );
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(parsed?.error || parsed?.message || `Request failed with ${response.status}`);
  }
  return parsed;
}
