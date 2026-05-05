import Database from "better-sqlite3";

const db = new Database("thermostat.db");

// creazione tabelle
db.exec(`
CREATE TABLE IF NOT EXISTS valves (
  id TEXT PRIMARY KEY,
  setpoint REAL,
  heating INTEGER,
  status TEXT DEFAULT 'OFFLINE',
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  temperature REAL,
  room_id TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  global_setpoint REAL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  valve_id TEXT,
  temperature REAL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

export default db;