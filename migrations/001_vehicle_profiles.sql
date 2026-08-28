-- Vehicle profiles are metadata only: photo_urls_json contains URLs, never binary data.
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
CREATE INDEX IF NOT EXISTS idx_vehicle_profiles_customer ON vehicle_profiles(customer_id);
