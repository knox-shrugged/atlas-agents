import { createClient } from "jsr:@supabase/supabase-js@2";

const FLY_API_TOKEN = Deno.env.get("FLY_API_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record;

    if (!record?.to_agent_id) {
      return new Response("no to_agent_id", { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: agent, error } = await supabase
      .from("agents")
      .select("fly_app_name, fly_machine_id, status")
      .eq("id", record.to_agent_id)
      .single();

    if (error || !agent) {
      console.error("agent lookup failed:", error);
      return new Response("agent not found", { status: 404 });
    }

    if (agent.status === "running") {
      console.log(`agent ${agent.fly_app_name} already running`);
      return new Response(JSON.stringify({ woke: false, reason: "already running" }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    const { fly_app_name, fly_machine_id } = agent;
    console.log(`waking ${fly_app_name} / ${fly_machine_id}`);

    const flyRes = await fetch(
      `https://api.machines.dev/v1/apps/${fly_app_name}/machines/${fly_machine_id}/start`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${FLY_API_TOKEN}` }
      }
    );

    const flyBody = await flyRes.text();
    console.log(`fly start → ${flyRes.status}: ${flyBody}`);

    // Mark agent as running in registry
    await supabase
      .from("agents")
      .update({ status: "running" })
      .eq("id", record.to_agent_id);

    return new Response(
      JSON.stringify({ woke: flyRes.ok, flyStatus: flyRes.status }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("wake-agent error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
