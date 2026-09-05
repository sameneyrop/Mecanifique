import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

type SqlValue = string | number | null;
type SqlParams = SqlValue[];

const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.resolve(dataDir, "mecanifique.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

export function run(sql: string, params: SqlParams = []): Promise<{ changes: number; lastID: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onResult(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

export function get<T>(sql: string, params: SqlParams = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row as T | undefined);
    });
  });
}

export function all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows as T[]);
    });
  });
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
  await ensureColumn("mechanics", "is_online", "ALTER TABLE mechanics ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("mechanics", "bio", "ALTER TABLE mechanics ADD COLUMN bio TEXT");
  await ensureColumn("mechanics", "cover_photo_url", "ALTER TABLE mechanics ADD COLUMN cover_photo_url TEXT");
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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled')),
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
  ); // Monto del apartado, copiado de mechanics.labor_rate al crear la
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

  // Disputas: el cliente reporta un problema con un servicio ya realizado.
  // Un admin revisa manualmente y decide la resolución — sin reglas
  // automáticas por ahora (ver README.md).
  await run(`
    CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_request_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('incomplete_work', 'incorrect_charge', 'vehicle_damage', 'other')),
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reported' CHECK(status IN ('reported', 'under_review', 'resolved')),
      resolution_note TEXT,
      refund_payment_id INTEGER,
      resolved_by_user_id INTEGER,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_request_id) REFERENCES service_requests(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(refund_payment_id) REFERENCES payments(id),
      FOREIGN KEY(resolved_by_user_id) REFERENCES users(id)
    );
  `);
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
}

async function ensureColumn(table: string, columnName: string, alterSql: string): Promise<void> {
  const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  await run(alterSql);
}

async function migrateRequestStatusConstraint(): Promise<void> {
  const schema = await get<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'service_requests'"
  );
  if (!schema?.sql || !schema.sql.includes("CHECK(status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled'))")) {
    return;
  }

  await run("ALTER TABLE service_requests RENAME TO service_requests_legacy");
  await run(`
    CREATE TABLE service_requests (
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
  await run(`
    INSERT INTO service_requests (
      id, customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description,
      preferred_time, city, zone, status, mechanic_id, diagnosis_notes, repair_notes,
      estimated_price, final_price, created_at, updated_at, latitude, longitude,
      hold_expires_at, schedule_slot_id
    )
    SELECT id, customer_id, vehicle_make, vehicle_model, vehicle_year, issue_description,
      preferred_time, city, zone, status, mechanic_id, diagnosis_notes, repair_notes,
      estimated_price, final_price, created_at, updated_at, latitude, longitude,
      hold_expires_at, schedule_slot_id
    FROM service_requests_legacy
  `);
  // service_address, deposit_amount, extra_amount, extra_status y
  // refund_amount NO se copian aquí a propósito: la tabla legacy nunca las
  // tuvo (este migrate corre antes que los ensureColumn de más arriba en
  // bases de datos nuevas), así que forzar su copia rompería el INSERT con
  // "no such column". Quedan en NULL, que es el valor correcto para
  // solicitudes que nunca pasaron por el flujo de pagos de todos modos.
  await run("DROP TABLE service_requests_legacy");
}