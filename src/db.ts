import fs from "node:fs";
import path from "node:path";

// @libsql/client publica sus tipos como módulo ES, pero incluye una versión
// CommonJS (la que carga este require); por eso se importa así y no con
// `import`, que TypeScript rechaza en un archivo CommonJS.
type LibsqlClientModule = typeof import("@libsql/client", { with: { "resolution-mode": "import" } });
type ResultSet = import("@libsql/client", { with: { "resolution-mode": "import" } }).ResultSet;
type InValue = import("@libsql/client", { with: { "resolution-mode": "import" } }).InValue;
const { createClient } = require("@libsql/client") as LibsqlClientModule;

type SqlValue = string | number | null | Uint8Array;
type SqlParams = SqlValue[];

/**
 * Base de datos operativa: SQLite, a través de libSQL.
 *
 * - En producción (Render) se usa Turso, SQLite en la nube, con
 *   TURSO_DATABASE_URL y TURSO_AUTH_TOKEN. El plan gratis de Render no
 *   permite discos: su sistema de archivos se borra en cada deploy y cada
 *   vez que el servicio se duerme, así que un archivo local ahí no
 *   conserva nada.
 * - Sin esas variables (desarrollo local y tests) se usa el archivo
 *   data/mecanifique.db, con el mismo motor y el mismo SQL.
 */
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();

function createDatabaseClient() {
  if (tursoUrl) {
    return createClient({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN?.trim() });
  }
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return createClient({ url: `file:${path.resolve(dataDir, "mecanifique.db")}` });
}

const db = createDatabaseClient();

export const databaseKind: "turso" | "local-file" = tursoUrl ? "turso" : "local-file";

function execute(sql: string, params: SqlParams): Promise<ResultSet> {
  return db.execute({ sql, args: params as InValue[] });
}

// Objeto plano {columna: valor}, igual que devolvía el driver sqlite3.
function toRow<T>(result: ResultSet, index: number): T {
  const row = result.rows[index];
  return Object.fromEntries(result.columns.map((column, columnIndex) => [column, row[columnIndex]])) as T;
}

export async function run(sql: string, params: SqlParams = []): Promise<{ changes: number; lastID: number }> {
  const result = await execute(sql, params);
  return { changes: result.rowsAffected, lastID: Number(result.lastInsertRowid ?? 0) };
}

export async function get<T>(sql: string, params: SqlParams = []): Promise<T | undefined> {
  const result = await execute(sql, params);
  return result.rows.length > 0 ? toRow<T>(result, 0) : undefined;
}

export async function all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
  const result = await execute(sql, params);
  return result.rows.map((_row, index) => toRow<T>(result, index));
}

/**
 * Varias escrituras como una sola: o se aplican todas o ninguna (si una
 * falla, se revierte lo anterior).
 */
export async function transaction(statements: Array<{ sql: string; params?: SqlParams }>): Promise<void> {
  await db.batch(
    statements.map(({ sql, params = [] }) => ({ sql, args: params as InValue[] })),
    "write"
  );
}

export async function initDb(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS mechanics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      city TEXT NOT NULL,
      zone TEXT NOT NULL,
      years_experience INTEGER NOT NULL,
      specialties TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_verification' CHECK(status IN ('pending_verification', 'active', 'suspended')),
      is_available INTEGER NOT NULL DEFAULT 0,
      rating REAL NOT NULL DEFAULT 5.0,
      jobs_completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await ensureColumn("mechanics", "latitude", "ALTER TABLE mechanics ADD COLUMN latitude REAL");
  await ensureColumn("mechanics", "longitude", "ALTER TABLE mechanics ADD COLUMN longitude REAL");
  // Cuándo llegó el último punto: el cliente que sigue al mecánico ve
  // "actualizado hace X".
  await ensureColumn("mechanics", "location_updated_at", "ALTER TABLE mechanics ADD COLUMN location_updated_at TEXT");
  // Última señal del teléfono del mecánico (sondeo con la app abierta o
  // servicio en primer plano con la app en otra pantalla). Si deja de
  // llegar, el barrido lo desconecta (sweepStaleMechanics).
  await ensureColumn("mechanics", "last_seen_at", "ALTER TABLE mechanics ADD COLUMN last_seen_at TEXT");
  // Cuándo se le recordó que cerró la app con un servicio en curso (una vez
  // por cada vez que deja de dar señal).
  await ensureColumn("mechanics", "stale_notice_at", "ALTER TABLE mechanics ADD COLUMN stale_notice_at TEXT");
  // Propina directa (src/tips.ts): CLABE opcional del mecánico y a nombre de
  // quién está. Solo la ve el cliente de un servicio terminado.
  await ensureColumn("mechanics", "tip_clabe", "ALTER TABLE mechanics ADD COLUMN tip_clabe TEXT");
  await ensureColumn("mechanics", "tip_holder_name", "ALTER TABLE mechanics ADD COLUMN tip_holder_name TEXT");
  await ensureColumn("mechanics", "is_online", "ALTER TABLE mechanics ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("mechanics", "bio", "ALTER TABLE mechanics ADD COLUMN bio TEXT");
  await ensureColumn("mechanics", "cover_photo_url", "ALTER TABLE mechanics ADD COLUMN cover_photo_url TEXT");
  // Foto de la cara del mecánico, obligatoria para conectarse: el cliente
  // ve quién va a llegar a su casa. Distinta de la portada (puede ser el taller).
  await ensureColumn("mechanics", "profile_photo_url", "ALTER TABLE mechanics ADD COLUMN profile_photo_url TEXT");
  // Sin foto no se puede estar conectado: los que ya lo estaban se desconectan
  // (vuelven a conectarse en cuanto la suben).
  await run("UPDATE mechanics SET is_online = 0, is_available = 0 WHERE profile_photo_url IS NULL AND is_online = 1");
  await ensureColumn("mechanics", "gallery_json", "ALTER TABLE mechanics ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn("mechanics", "review_count", "ALTER TABLE mechanics ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(
    "mechanics",
    "labor_rate",
    "ALTER TABLE mechanics ADD COLUMN labor_rate REAL"
  ); // Tarifa fija de mano de obra en MXN, definida por el propio mecánico.
     // También funciona como su apartado mínimo por defecto — ver el
     // modelo de pagos documentado en README.md.

  await run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS vehicle_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      nickname TEXT,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      year INTEGER NOT NULL CHECK(year BETWEEN 1886 AND 2100),
      license_plate TEXT,
      color TEXT,
      mileage INTEGER,
      photo_urls_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_vehicle_profiles_customer ON vehicle_profiles(customer_id)");
  await ensureColumn("vehicle_profiles", "engine_type", "ALTER TABLE vehicle_profiles ADD COLUMN engine_type TEXT");
  await ensureColumn("vehicle_profiles", "transmission_type", "ALTER TABLE vehicle_profiles ADD COLUMN transmission_type TEXT");
  await ensureColumn(
    "vehicle_profiles",
    "is_primary",
    "ALTER TABLE vehicle_profiles ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0"
  );

  await run(`
    CREATE TABLE IF NOT EXISTS service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      vehicle_make TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      vehicle_year INTEGER NOT NULL,
      issue_description TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      city TEXT NOT NULL,
      zone TEXT NOT NULL,
      service_address TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'in_progress', 'en_route', 'on_site', 'diagnosing', 'repairing', 'awaiting_parts', 'completed', 'cancelled')),
      mechanic_id INTEGER,
      diagnosis_notes TEXT,
      repair_notes TEXT,
      estimated_price REAL,
      final_price REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    );
  `);

  await ensureColumn(
    "service_requests",
    "latitude",
    "ALTER TABLE service_requests ADD COLUMN latitude REAL"
  );
  await ensureColumn(
    "service_requests",
    "longitude",
    "ALTER TABLE service_requests ADD COLUMN longitude REAL"
  );
  await ensureColumn(
    "service_requests",
    "service_address",
    "ALTER TABLE service_requests ADD COLUMN service_address TEXT"
  );
  await ensureColumn(
    "service_requests",
    "hold_expires_at",
    "ALTER TABLE service_requests ADD COLUMN hold_expires_at TEXT"
  );
  await ensureColumn(
    "service_requests",
    "schedule_slot_id",
    "ALTER TABLE service_requests ADD COLUMN schedule_slot_id INTEGER"
  );
  // --- Modelo de pagos: apartado + ajuste (ver README.md) ---
  await ensureColumn(
    "service_requests",
    "deposit_amount",
    "ALTER TABLE service_requests ADD COLUMN deposit_amount REAL"
  ); // Monto del apartado (40% de mechanics.labor_rate, ver
     // src/payments.ts::calculateDepositAmount), calculado al crear la
     // solicitud (así, si el mecánico cambia su tarifa después, no afecta
     // solicitudes ya en curso).
  await ensureColumn(
    "service_requests",
    "extra_amount",
    "ALTER TABLE service_requests ADD COLUMN extra_amount REAL"
  ); // Monto adicional propuesto por el mecánico tras diagnosticar, cuando
     // el costo real supera el apartado. NULL si no aplica.
  await ensureColumn(
    "service_requests",
    "extra_status",
    "ALTER TABLE service_requests ADD COLUMN extra_status TEXT CHECK(extra_status IN ('pending', 'accepted', 'rejected'))"
  ); // Estado de aceptación del cliente sobre extra_amount. El mecánico no
     // debe comprar refacciones ni continuar hasta que sea 'accepted'.
  await ensureColumn(
    "service_requests",
    "refund_amount",
    "ALTER TABLE service_requests ADD COLUMN refund_amount REAL"
  ); // Si el costo real fue MENOR al apartado, la diferencia a devolver.
  await migrateRequestStatusConstraint();
  // Va DESPUÉS de migrateRequestStatusConstraint a propósito: en una base
  // vieja esa función reconstruye la tabla con una lista fija de columnas, y
  // una columna agregada antes se perdería en la reconstrucción.
  await ensureColumn(
    "service_requests",
    "assignment_mode",
    "ALTER TABLE service_requests ADD COLUMN assignment_mode TEXT CHECK(assignment_mode IN ('auto', 'direct'))"
  ); // 'auto': la app eligió al mecánico y puede reasignar si no responde.
     // 'direct': el cliente eligió a ese mecánico (o su turno); no se
     // reasigna a otro sin que el cliente lo pida. NULL (solicitudes viejas)
     // se trata como 'auto'.
  // Cobro al terminar (src/servicePayment.ts): el precio de la visita y
  // diagnóstico se fija cuando el mecánico acepta (si luego cambia su tarifa,
  // no afecta a servicios ya aceptados) y paid_at es cuándo el mecánico
  // confirmó que el cliente ya le pagó.
  await ensureColumn("service_requests", "visit_fee", "ALTER TABLE service_requests ADD COLUMN visit_fee REAL");
  await ensureColumn("service_requests", "paid_at", "ALTER TABLE service_requests ADD COLUMN paid_at TEXT");
  // Lo que dice el cliente ('cash' o 'transfer') y cuándo, y cuándo el
  // mecánico reportó que no le pagaron. Nadie decide solo si se pagó.
  await ensureColumn("service_requests", "customer_paid_at", "ALTER TABLE service_requests ADD COLUMN customer_paid_at TEXT");
  await ensureColumn("service_requests", "payment_method", "ALTER TABLE service_requests ADD COLUMN payment_method TEXT");
  await ensureColumn("service_requests", "unpaid_reported_at", "ALTER TABLE service_requests ADD COLUMN unpaid_reported_at TEXT");
  // Cuándo salió por refacciones sin haber subido todavía el ticket (o dicho
  // que no compró nada): mientras tenga valor, no puede retomar la reparación.
  await ensureColumn("service_requests", "parts_trip_started_at", "ALTER TABLE service_requests ADD COLUMN parts_trip_started_at TEXT");
  // Visita de regreso (src/returnVisits.ts): la solicitud original de la que
  // viene. Sin cobro de visita: el mecánico vuelve a terminar con la pieza.
  await ensureColumn("service_requests", "parent_request_id", "ALTER TABLE service_requests ADD COLUMN parent_request_id INTEGER");
  // Cancelaciones (src/cancellations.ts): cuándo aceptó, salió y llegó el
  // mecánico (el cargo por cancelar depende de eso), quién canceló y por qué,
  // cuánto le toca al mecánico, y la foto si marcó que el cliente no estaba.
  await ensureColumn("service_requests", "accepted_at", "ALTER TABLE service_requests ADD COLUMN accepted_at TEXT");
  await ensureColumn("service_requests", "en_route_at", "ALTER TABLE service_requests ADD COLUMN en_route_at TEXT");
  await ensureColumn("service_requests", "arrived_at", "ALTER TABLE service_requests ADD COLUMN arrived_at TEXT");
  await ensureColumn("service_requests", "cancelled_by", "ALTER TABLE service_requests ADD COLUMN cancelled_by TEXT");
  await ensureColumn("service_requests", "cancel_reason", "ALTER TABLE service_requests ADD COLUMN cancel_reason TEXT");
  await ensureColumn("service_requests", "cancellation_fee", "ALTER TABLE service_requests ADD COLUMN cancellation_fee REAL");
  await ensureColumn("service_requests", "absence_photo_url", "ALTER TABLE service_requests ADD COLUMN absence_photo_url TEXT");
  // Al pedir: foto del auto y del lugar donde está (con el número de la casa
  // si se ve), para que el mecánico llegue al lugar correcto. location_source:
  // 'gps' (el auto está donde está el cliente) o 'address' (en otro lugar: las
  // coordenadas salen de la dirección escrita).
  await ensureColumn("service_requests", "car_photo_url", "ALTER TABLE service_requests ADD COLUMN car_photo_url TEXT");
  await ensureColumn("service_requests", "spot_photo_url", "ALTER TABLE service_requests ADD COLUMN spot_photo_url TEXT");
  await ensureColumn(
    "service_requests",
    "location_source",
    "ALTER TABLE service_requests ADD COLUMN location_source TEXT CHECK(location_source IN ('gps', 'address'))"
  );
  await ensureColumn("service_requests", "absence_reminder_at", "ALTER TABLE service_requests ADD COLUMN absence_reminder_at TEXT");
  // "Ya no puedo ir": queda en el historial del mecánico (se suspende a quien
  // lo hace seguido).
  await run(`
    CREATE TABLE IF NOT EXISTS mechanic_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_mechanic_withdrawals_mechanic ON mechanic_withdrawals(mechanic_id, created_at)");

  // Comisión de Mecanifique (src/commissions.ts): 10 % de la visita y la mano
  // de obra de cada servicio terminado, que el mecánico paga en un corte
  // semanal. waived_reason: gratis (p. ej. sus primeros 30 días).
  await run(`
    CREATE TABLE IF NOT EXISTS commission_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mechanic_id INTEGER NOT NULL,
      service_request_id INTEGER NOT NULL UNIQUE,
      base_amount REAL NOT NULL,
      commission REAL NOT NULL,
      waived_reason TEXT,
      statement_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id),
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_commission_charges_mechanic ON commission_charges(mechanic_id, statement_id)");
  await run(`
    CREATE TABLE IF NOT EXISTS commission_statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mechanic_id INTEGER NOT NULL,
      period_key TEXT NOT NULL,
      total REAL NOT NULL,
      services INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'paid')),
      due_at TEXT NOT NULL,
      paid_at TEXT,
      paid_via TEXT,
      checkout_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mechanic_id, period_key),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS service_request_declines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('rejected', 'expired')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(service_request_id, mechanic_id),
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS service_request_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('mechanic', 'system')),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS service_request_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      sender_user_id INTEGER NOT NULL,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('customer', 'mechanic', 'admin')),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(sender_user_id) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS mechanic_schedule_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mechanic_id INTEGER NOT NULL,
      slot_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'reserved', 'blocked')),
      service_request_id INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id),
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS mechanic_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mechanic_id INTEGER NOT NULL,
      service_request_id INTEGER NOT NULL UNIQUE,
      customer_user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id),
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(customer_user_id) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      data_json TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      push_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('customer', 'mechanic', 'admin')),
      login TEXT NOT NULL UNIQUE,
      supabase_user_id TEXT UNIQUE,
      full_name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      customer_id INTEGER UNIQUE,
      mechanic_id INTEGER UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    );
  `);
  await ensureColumn(
    "users",
    "supabase_user_id",
    "ALTER TABLE users ADD COLUMN supabase_user_id TEXT"
  );
  // Forzamos UNIQUE aquí porque en bases de datos existentes, la columna se
  // agregó vía ALTER TABLE ADD COLUMN (arriba), que en SQLite no admite
  // UNIQUE inline. Sin esto, dos peticiones concurrentes de un mismo login
  // (ver ensureLocalUser) podían insertar dos filas para el mismo usuario
  // de Supabase, y la que "ganaba la carrera" a veces quedaba con el rol
  // por defecto (customer) en vez del rol real. Bug confirmado en
  // producción el 2026-09-05 con logs de diagnóstico.
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_user_id ON users(supabase_user_id) WHERE supabase_user_id IS NOT NULL");

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS identity_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('customer', 'mechanic')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected')),
      consent_at TEXT NOT NULL,
      submitted_at TEXT,
      reviewed_at TEXT,
      reviewed_by_user_id INTEGER,
      reviewer_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id)
    );
  `);

  await ensureColumn(
    "identity_verifications",
    "didit_session_id",
    "ALTER TABLE identity_verifications ADD COLUMN didit_session_id TEXT"
  );

  await run(`
    CREATE TABLE IF NOT EXISTS identity_verification_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verification_id INTEGER NOT NULL,
      document_type TEXT NOT NULL
        CHECK(document_type IN ('ine_front', 'ine_back', 'selfie', 'proof_of_address', 'criminal_record')),
      storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(verification_id, document_type),
      FOREIGN KEY(verification_id) REFERENCES identity_verifications(id) ON DELETE CASCADE
    );
  `);

  // Historial de cada movimiento de dinero real de una solicitud: la
  // autorización del apartado, su captura, el cargo extra si aplica, y
  // cualquier reembolso. Una fila por evento, no por solicitud — así se
  // puede auditar exactamente qué pasó y cuándo, incluso si algo falla a
  // medio camino con el procesador de pagos.
  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('deposit_authorization', 'deposit_capture', 'extra_charge', 'refund')),
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'succeeded', 'failed', 'cancelled')),
      provider TEXT,
      provider_reference TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id)
    );
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_payments_service_request ON payments(service_request_id)");

  // Disputas: el cliente reporta un problema con un servicio ya realizado, o
  // se abren solas cuando el pago no cuadra (src/servicePayment.ts: el
  // mecánico reporta que no le pagaron, o dice que no y el cliente que sí).
  // Un admin revisa manualmente y decide la resolución (ver README.md).
  await run(`CREATE TABLE IF NOT EXISTS disputes (${DISPUTES_COLUMNS})`);
  await migrateDisputeCategories();
  await run("CREATE INDEX IF NOT EXISTS idx_disputes_service_request ON disputes(service_request_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at)");

  // Registro de auditoría del botón de pánico/911: la llamada real al 911
  // siempre la hace el sistema operativo directo (tel:911), sin pasar por
  // este backend ni depender de él — esto solo deja constancia de quién
  // presionó el botón, desde qué solicitud y con qué ubicación, para que un
  // admin pueda dar seguimiento después. Nunca debe bloquear ni retrasar la
  // llamada real.
  await run(`
    CREATE TABLE IF NOT EXISTS panic_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER,
      reporter_user_id INTEGER NOT NULL,
      reporter_role TEXT NOT NULL CHECK(reporter_role IN ('customer', 'mechanic', 'admin')),
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(reporter_user_id) REFERENCES users(id)
    );
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_panic_alerts_created_at ON panic_alerts(created_at DESC)");

  // Mecánicos guardados por un cliente (corazón en su perfil).
  await run(`
    CREATE TABLE IF NOT EXISTS favorite_mechanics (
      user_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, mechanic_id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);

  // "Reportar un problema" y "Obtener ayuda" desde Cuenta: quedan aquí y se
  // avisa a los administradores con una notificación.
  await run(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('problem', 'help')),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Comunidad: preguntas de cualquier usuario, respuestas de mecánicos
  // verificados, y reacciones (seguir una pregunta / marcar útil una respuesta).
  await run(`
    CREATE TABLE IF NOT EXISTS community_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('frenos', 'suspension', 'transmision', 'motor', 'electrico', 'llantas', 'otro')),
      vehicle_label TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(author_user_id) REFERENCES users(id)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_community_questions_created_at ON community_questions(created_at DESC)");
  await run(`
    CREATE TABLE IF NOT EXISTS community_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      author_user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(question_id) REFERENCES community_questions(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id),
      FOREIGN KEY(author_user_id) REFERENCES users(id)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_community_answers_question ON community_answers(question_id)");
  await run(`
    CREATE TABLE IF NOT EXISTS community_reactions (
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('question', 'answer')),
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, target_type, target_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Promociones que publica cada mecánico (ej. "revisión gratis al
  // contratar mi servicio"). valid_until es AAAA-MM-DD o NULL (sin fecha).
  await run(`
    CREATE TABLE IF NOT EXISTS mechanic_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mechanic_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      valid_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);

  // Cuándo se eliminó la cuenta (la fila queda anonimizada, ver
  // src/accountDeletion.ts).
  await ensureColumn("users", "deleted_at", "ALTER TABLE users ADD COLUMN deleted_at TEXT");

  // Solicitudes de eliminación hechas desde la página web /eliminar-cuenta
  // (Google Play exige poder pedirla también fuera de la app).
  await run(`
    CREATE TABLE IF NOT EXISTS account_deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Verificación por teléfono (ver src/phoneVerification.ts): el número
  // confirmado de cada cuenta y los teléfonos desde los que ya entró.
  await ensureColumn("users", "verified_phone", "ALTER TABLE users ADD COLUMN verified_phone TEXT");
  await ensureColumn("users", "phone_verified_at", "ALTER TABLE users ADD COLUMN phone_verified_at TEXT");
  await run(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, device_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Cotizaciones del mecánico (ver src/quotes.ts). Sin una aceptada no se
  // puede reparar.
  await run(`
    CREATE TABLE IF NOT EXISTS service_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      labor_amount REAL NOT NULL,
      parts_amount REAL NOT NULL DEFAULT 0,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'replaced')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at TEXT,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_service_quotes_request ON service_quotes(service_request_id)");
  // Refacciones que ya trae el mecánico (precio fijo). NULL en cotizaciones
  // anteriores a los tickets: ahí parts_amount era un precio fijo. En las
  // nuevas, parts_amount es lo estimado de las refacciones a comprar, que se
  // cobran a precio de ticket (src/partsReceipts.ts).
  await ensureColumn("service_quotes", "parts_on_hand_amount", "ALTER TABLE service_quotes ADD COLUMN parts_on_hand_amount REAL");
  // 'adjustment': baja lo acordado (p. ej. la pieza no estaba y no se hizo
  // toda la reparación). Al aceptarla reemplaza a las cotizaciones aceptadas.
  await ensureColumn(
    "service_quotes",
    "kind",
    "ALTER TABLE service_quotes ADD COLUMN kind TEXT NOT NULL DEFAULT 'quote' CHECK(kind IN ('quote', 'adjustment'))"
  );

  // Tickets de las refacciones que compra el mecánico (src/partsReceipts.ts):
  // foto tomada con la cámara de la app y lo que costó. status: 'accepted'
  // (dentro de lo estimado o aprobado por el cliente), 'pending' (el cliente
  // tiene que aprobarlo: pasa de lo estimado o no hay ticket) o 'rejected'.
  await run(`
    CREATE TABLE IF NOT EXISTS parts_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      has_ticket INTEGER NOT NULL DEFAULT 1,
      photo_url TEXT NOT NULL,
      store_note TEXT,
      status TEXT NOT NULL CHECK(status IN ('accepted', 'pending', 'rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at TEXT,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_parts_receipts_request ON parts_receipts(service_request_id)");
  // Pieza pedida que llega otro día: el cliente la paga hoy (con el ticket
  // del pedido) y se instala en la visita de regreso.
  await ensureColumn("parts_receipts", "ordered", "ALTER TABLE parts_receipts ADD COLUMN ordered INTEGER NOT NULL DEFAULT 0");

  // Cuota de servicio (ver src/serviceFees.ts): una fila por pago en Stripe
  // Checkout. claimed_at marca que ya se usó para una solicitud.
  await run(`
    CREATE TABLE IF NOT EXISTS service_fees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      checkout_session_id TEXT NOT NULL UNIQUE,
      payment_intent_id TEXT,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'authorized', 'captured', 'released', 'failed')),
      service_request_id INTEGER UNIQUE,
      claimed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id)
    )
  `);

  // Lista de espera del sitio web (antes de publicar la app). contact_key es
  // el contacto normalizado (correo en minúsculas o solo dígitos del
  // teléfono) para no guardar dos veces a la misma persona.
  await run(`
    CREATE TABLE IF NOT EXISTS waitlist_signups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('customer', 'mechanic')),
      name TEXT,
      contact TEXT NOT NULL,
      contact_key TEXT NOT NULL,
      city TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contact_key, role)
    )
  `);
  // Evidencia del servicio (src/serviceEvidence.ts): fotos de antes y después
  // que toma el mecánico, qué pasó con las piezas cambiadas y la garantía de la
  // mano de obra en la cotización.
  await run(`
    CREATE TABLE IF NOT EXISTS service_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('before', 'after')),
      photo_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_service_photos_request ON service_photos(service_request_id)");
  await ensureColumn(
    "service_requests",
    "old_parts_status",
    "ALTER TABLE service_requests ADD COLUMN old_parts_status TEXT CHECK(old_parts_status IN ('delivered', 'declined', 'none'))"
  );
  await ensureColumn("service_quotes", "warranty_days", "ALTER TABLE service_quotes ADD COLUMN warranty_days INTEGER");
  // Cuándo se terminó (la fecha del comprobante y desde cuándo corre la garantía).
  await ensureColumn("service_requests", "completed_at", "ALTER TABLE service_requests ADD COLUMN completed_at TEXT");

  // Refaccionarias (src/partsStores.ts): directorio para que el mecánico busque
  // una pieza cerca del auto. Las de la lista oficial llegan con seed_key (se
  // cargan de src/partsStoresSeed.ts al arrancar); las que sugieren los
  // mecánicos entran como 'pending' hasta que un admin las aprueba.
  await run(`
    CREATE TABLE IF NOT EXISTS parts_stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      whatsapp TEXT,
      address TEXT,
      zone TEXT,
      city TEXT NOT NULL DEFAULT 'Aguascalientes',
      latitude REAL,
      longitude REAL,
      hours TEXT,
      specialties TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'rejected')),
      suggested_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // "Sí tenían la pieza": lo marca el mecánico; así se sabe qué tienda surte qué.
  await run(`
    CREATE TABLE IF NOT EXISTS parts_store_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      service_request_id INTEGER,
      part TEXT,
      vehicle TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Foto del cliente (opcional): el mecánico sabe a quién busca al llegar.
  await ensureColumn("customers", "photo_url", "ALTER TABLE customers ADD COLUMN photo_url TEXT");

  // Cuándo el admin marcó que ya le escribió (Acciones → Lista de espera).
  await ensureColumn("waitlist_signups", "contacted_at", "ALTER TABLE waitlist_signups ADD COLUMN contacted_at TEXT");

  // Celulares desde los que se usó cada cuenta (huella del X-Device-Id, no
  // el valor), para reconocer una cuenta nueva abierta para no pagar (ver
  // src/unpaidFingerprints.ts).
  await run(`
    CREATE TABLE IF NOT EXISTS user_devices (
      user_id INTEGER NOT NULL,
      device_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, device_hash)
    )
  `);
  // Huellas de la cuenta que dejó un servicio sin pagar: sobreviven a que la
  // cuenta se elimine y dejan de contar solas cuando el servicio se paga.
  await run(`
    CREATE TABLE IF NOT EXISTS unpaid_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      customer_id INTEGER,
      kind TEXT NOT NULL CHECK(kind IN ('phone', 'email', 'device', 'location')),
      value_hash TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(service_request_id, kind, value_hash)
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_unpaid_fingerprints_value ON unpaid_fingerprints(kind, value_hash)");

  // El mecánico califica al cliente al terminar (ver src/customerReviews.ts).
  await run(`
    CREATE TABLE IF NOT EXISTS customer_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL,
      mechanic_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run("CREATE INDEX IF NOT EXISTS idx_customer_reviews_customer ON customer_reviews(customer_id)");

  // Fotos subidas desde la app (ver src/uploads.ts): en la base y no en
  // disco, porque el disco de Render gratis no persiste.
  await run(`
    CREATE TABLE IF NOT EXISTS uploaded_photos (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg', 'image/png')),
      data BLOB NOT NULL,
      uploaded_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(uploaded_by_user_id) REFERENCES users(id)
    )
  `);
}

async function ensureColumn(table: string, columnName: string, alterSql: string): Promise<void> {
  const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  await run(alterSql);
}

/**
 * Solo para bases creadas antes de que existieran los estados en camino,
 * en sitio, diagnóstico, etc.: SQLite no permite cambiar un CHECK, así que
 * se reconstruye la tabla. Las bases nuevas ya se crean con el CHECK
 * completo y no pasan por aquí.
 *
 * Receta segura de SQLite: tabla nueva → copiar → borrar la vieja →
 * renombrar la nueva. (Antes se renombraba la VIEJA a
 * service_requests_legacy, y SQLite reescribía hacia ese nombre las llaves
 * foráneas de otras tablas; al borrarla quedaban apuntando a una tabla
 * inexistente, y con llaves foráneas activas —como en libSQL/Turso— toda
 * escritura en solicitudes fallaba.)
 */
// opened_by: 'customer' (reporte del cliente), 'mechanic' (el mecánico
// reporta que no le pagaron) o 'system' (los dos dicen cosas distintas del pago).
const DISPUTES_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_request_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('incomplete_work', 'incorrect_charge', 'vehicle_damage', 'other', 'unpaid', 'payment_disagreement')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported', 'under_review', 'resolved')),
  resolution_note TEXT,
  refund_payment_id INTEGER,
  resolved_by_user_id INTEGER,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_by TEXT NOT NULL DEFAULT 'customer' CHECK(opened_by IN ('customer', 'mechanic', 'system')),
  FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id),
  FOREIGN KEY(refund_payment_id) REFERENCES payments(id),
  FOREIGN KEY(resolved_by_user_id) REFERENCES users(id)
`;

/**
 * SQLite no deja cambiar un CHECK: una tabla de disputas anterior a las
 * categorías de pago se reconstruye con las mismas filas (igual que
 * migrateRequestStatusConstraint). Los índices se crean después.
 */
async function migrateDisputeCategories(): Promise<void> {
  const schema = await get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'disputes'");
  if (!schema?.sql || schema.sql.includes("'payment_disagreement'")) {
    return;
  }
  const oldColumns = (await all<{ name: string }>("PRAGMA table_info(disputes)")).map((column) => column.name);
  await run("PRAGMA foreign_keys = OFF");
  await run("DROP TABLE IF EXISTS disputes_rebuilt");
  await run(`CREATE TABLE disputes_rebuilt (${DISPUTES_COLUMNS})`);
  const newColumns = (await all<{ name: string }>("PRAGMA table_info(disputes_rebuilt)")).map((column) => column.name);
  const sharedColumns = oldColumns.filter((column) => newColumns.includes(column)).join(", ");
  await run(`INSERT INTO disputes_rebuilt (${sharedColumns}) SELECT ${sharedColumns} FROM disputes`);
  await run("DROP TABLE disputes");
  await run("ALTER TABLE disputes_rebuilt RENAME TO disputes");
  await run("PRAGMA foreign_keys = ON");
}

async function migrateRequestStatusConstraint(): Promise<void> {
  const schema = await get<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'service_requests'"
  );
  if (!schema?.sql || !schema.sql.includes("CHECK(status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled'))")) {
    return;
  }

  const oldColumns = (await all<{ name: string }>("PRAGMA table_info(service_requests)")).map((column) => column.name);

  await run("PRAGMA foreign_keys = OFF");
  await run("DROP TABLE IF EXISTS service_requests_rebuilt");
  await run(`
    CREATE TABLE service_requests_rebuilt (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      vehicle_make TEXT NOT NULL,
      vehicle_model TEXT NOT NULL,
      vehicle_year INTEGER NOT NULL,
      issue_description TEXT NOT NULL,
      preferred_time TEXT NOT NULL,
      city TEXT NOT NULL,
      zone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'in_progress', 'en_route', 'on_site', 'diagnosing', 'repairing', 'awaiting_parts', 'completed', 'cancelled')),
      mechanic_id INTEGER,
      diagnosis_notes TEXT,
      repair_notes TEXT,
      estimated_price REAL,
      final_price REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      latitude REAL,
      longitude REAL,
      hold_expires_at TEXT,
      schedule_slot_id INTEGER,
      service_address TEXT,
      deposit_amount REAL,
      extra_amount REAL,
      extra_status TEXT CHECK(extra_status IN ('pending', 'accepted', 'rejected')),
      refund_amount REAL,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(mechanic_id) REFERENCES mechanics(id)
    );
  `);
  const newColumns = (await all<{ name: string }>("PRAGMA table_info(service_requests_rebuilt)")).map((column) => column.name);
  const sharedColumns = oldColumns.filter((column) => newColumns.includes(column)).join(", ");
  await run(`INSERT INTO service_requests_rebuilt (${sharedColumns}) SELECT ${sharedColumns} FROM service_requests`);
  await run("DROP TABLE service_requests");
  await run("ALTER TABLE service_requests_rebuilt RENAME TO service_requests");
  await run("PRAGMA foreign_keys = ON");
}
