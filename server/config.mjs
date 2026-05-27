import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  flyApiToken: process.env.FLY_API_TOKEN || "",
  flyOrgSlug: process.env.FLY_ORG_SLUG || "personal",
  defaultRegion: process.env.ATLAS_DEFAULT_REGION || "den",
  runtimeImage: process.env.FLY_RUNTIME_IMAGE || "",
  opencodeRuntimeImage: process.env.FLY_OPENCODE_RUNTIME_IMAGE || "",
  claudeRuntimeImage: process.env.FLY_CLAUDE_RUNTIME_IMAGE || "",
  piRuntimeImage: process.env.FLY_PI_RUNTIME_IMAGE || "",
  codexRuntimeImage: process.env.FLY_CODEX_RUNTIME_IMAGE || "",
  aiderRuntimeImage: process.env.FLY_AIDER_RUNTIME_IMAGE || "",
  gooseRuntimeImage: process.env.FLY_GOOSE_RUNTIME_IMAGE || "",
  flyApiHostname: process.env.FLY_API_HOSTNAME || "https://api.machines.dev",
  openrouterApiKey: process.env.OPENROUTER || "",
  openrouterProvisionerKey: process.env.OPENROUTER_PROVISIONER_KEY || "",
  supabaseUrl: process.env.SUPABASE_URL || "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  vercelToken: process.env.VERCEL_TOKEN || "",
  supabasePat: process.env.SUPABASE_PAT || "",
  composioApiKey: process.env.COMPOSIO_API_KEY || "",
};

export function publicConfig() {
  return {
    flyConfigured: Boolean(config.flyApiToken && config.flyOrgSlug),
    runtimeImageConfigured: Boolean(config.runtimeImage),
    flyOrgSlug: config.flyOrgSlug,
    defaultRegion: config.defaultRegion
  };
}

