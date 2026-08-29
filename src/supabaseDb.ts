export type SupabaseDbStatus = {
  configured: boolean;
  connected: boolean;
  projectUrl: string | null;
  message: string;
  tables: string[];
};

function getSupabaseConfig() {
  const projectUrl = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  return { projectUrl, anonKey };
}

export async function getSupabaseDbHealth(): Promise<SupabaseDbStatus> {
  const { projectUrl, anonKey } = getSupabaseConfig();

  if (!projectUrl || !anonKey) {
    return {
      configured: false,
      connected: false,
      projectUrl: projectUrl || null,
      message: "SUPABASE_URL y SUPABASE_ANON_KEY no están configurados para validar la BD",
      tables: [],
    };
  }

  const candidateTables = [
    "mechanics",
    "customers",
    "service_requests",
    "service_request_updates",
    "users",
    "mechanic_schedule_slots",
  ];

  const results = await Promise.allSettled(
    candidateTables.map(async (tableName) => {
      const requestUrl = new URL(`${projectUrl.replace(/\/$/, "")}/rest/v1/${tableName}`);
      requestUrl.searchParams.set("select", "id");
      requestUrl.searchParams.set("limit", "1");

      const response = await fetch(requestUrl.toString(), {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: "application/json",
        },
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `HTTP ${response.status}`);
      }

      return tableName;
    })
  );

  const reachableTables = results
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value);

  if (reachableTables.length > 0) {
    return {
      configured: true,
      connected: true,
      projectUrl,
      message: "La conexión a Supabase está activa y la base de datos responde.",
      tables: reachableTables,
    };
  }

  const failure = results[0] && results[0].status === "rejected"
    ? (results[0].reason as Error)
    : new Error("No fue posible consultar ninguna tabla principal");

  return {
    configured: true,
    connected: false,
    projectUrl,
    message: failure.message,
    tables: [],
  };
}
