import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

let supabaseClient: any = null;

export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      "⚠️  Supabase credentials not found. Set SUPABASE_URL and SUPABASE_ANON_KEY env vars."
    );
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
      },
      global: {
        headers: {
          "User-Agent": "mecanifique-api/1.0",
        },
      },
    });
  }

  return supabaseClient;
}

// For convenience, also export as `supabase` but it's lazy-loaded
export const supabase = new Proxy(
  {},
  {
    get: (target, prop) => {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error(
          "Supabase client not initialized. Check SUPABASE_URL and SUPABASE_ANON_KEY."
        );
      }
      return (client as any)[prop];
    },
  }
) as any;

export type SupabaseClient = typeof supabase;

