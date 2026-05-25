#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const AGENT_ID = process.env.AGENT_ID ?? "";

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

async function sbFetch(method, path, body, extra = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { ...BASE_HEADERS, ...extra },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

const server = new McpServer({ name: "atlas", version: "1.0.0" });

server.tool(
  "send_message",
  "Send a task to another agent. Returns the message ID to pass to wait_for_reply.",
  {
    to_agent_id: z.string().describe("Target agent UUID (from agent_lookup)"),
    payload: z.string().describe("Task payload — runs as a bash command on shell-agents, as a natural-language prompt on claude-agent / opencode-agent"),
  },
  async ({ to_agent_id, payload }) => {
    const body = {
      to_agent_id,
      payload,
      status: "pending",
      ...(AGENT_ID ? { from_agent_id: AGENT_ID } : {}),
    };
    const rows = await sbFetch("POST", "messages", body, { Prefer: "return=representation" });
    const id = (Array.isArray(rows) ? rows[0] : rows)?.id;
    if (!id) throw new Error("send_message: no id returned from Supabase");
    return { content: [{ type: "text", text: id }] };
  }
);

server.tool(
  "wait_for_reply",
  "Block until an agent finishes its task and return the result.",
  {
    message_id: z.string().describe("Message ID returned by send_message"),
    timeout_seconds: z.number().optional().default(120).describe("Max wait in seconds (default 120)"),
  },
  async ({ message_id, timeout_seconds = 120 }) => {
    const deadline = Date.now() + timeout_seconds * 1000;
    while (Date.now() < deadline) {
      const rows = await sbFetch("GET", `messages?id=eq.${message_id}&select=status,result`);
      const msg = Array.isArray(rows) ? rows[0] : rows;
      if (msg?.status === "done") {
        return { content: [{ type: "text", text: msg.result ?? "" }] };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`wait_for_reply: timed out after ${timeout_seconds}s (message ${message_id})`);
  }
);

server.tool(
  "agent_lookup",
  "Find registered agents by kind. Use this to get agent IDs before calling send_message.",
  {
    kind: z.enum(["claude-agent", "opencode-agent", "shell-agent"]).describe("Agent kind to search for"),
    first: z.boolean().optional().default(false).describe("Return only the first available agent"),
  },
  async ({ kind, first }) => {
    let rows = await sbFetch("GET", `agents?kind=eq.${kind}&select=id,fly_app_name,status&order=last_seen.desc`);
    if (!Array.isArray(rows)) rows = [];
    if (AGENT_ID) rows = rows.filter((r) => r.id !== AGENT_ID);
    if (first) rows = rows.slice(0, 1);
    const text = rows.length
      ? rows.map((r) => `${r.id}  ${r.fly_app_name}  (${r.status})`).join("\n")
      : "No agents found";
    return { content: [{ type: "text", text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
