import Database from "better-sqlite3";

const db = new Database("thermostat.db");

// creazione tabelle
db.exec(`
CREATE TABLE IF NOT EXISTS valves (
  id TEXT PRIMARY KEY,
  setpoint REAL,
  heating INTEGER
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  valve_id TEXT,
  temperature REAL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

export default db;