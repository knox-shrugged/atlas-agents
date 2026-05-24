import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Agent = {
  id: string;
  fly_app_name: string;
  fly_machine_id: string | null;
  fly_region: string | null;
  kind: string;
  status: string;
  last_seen: string;
  created_at: string;
};

export type Message = {
  id: string;
  from_agent_id: string | null;
  to_agent_id: string;
  payload: string;
  status: string;
  result: string | null;
  created_at: string;
  updated_at: string;
};
