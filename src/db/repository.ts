import db from "./database.js";

// salva o aggiorna valvola
export function upsertValve(id: string, setpoint: number, heating: boolean, temperature?: number) {
  const stmt = db.prepare(`
    INSERT INTO valves (id, setpoint, heating, status, last_seen, temperature)
    VALUES (?, ?, ?, 'ONLINE', CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      setpoint = excluded.setpoint,
      heating = excluded.heating,
      status = 'ONLINE',
      last_seen = CURRENT_TIMESTAMP,
      temperature = COALESCE(excluded.temperature, temperature)
  `);

  stmt.run(id, setpoint, heating ? 1 : 0, temperature || null);
}

// aggiorna lo status della valvola
export function updateValveStatus(id: string, status: 'ONLINE' | 'OFFLINE') {
  const stmt = db.prepare(`
    UPDATE valves SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?
  `);
  stmt.run(status, id);
}

// salva temperatura
export function insertTemperature(valveId: string, temperature: number) {
  const stmt = db.prepare(`
    INSERT INTO temperature_readings (valve_id, temperature)
    VALUES (?, ?)
  `);

  stmt.run(valveId, temperature);
}

// leggi tutte le valvole
export function getValves() {
  return db.prepare("SELECT * FROM valves").all();
}

// storico temperatura
export function getTemperatureHistory(valveId: string) {
  return db
    .prepare(
      "SELECT * FROM temperature_readings WHERE valve_id = ? ORDER BY timestamp DESC LIMIT 50"
    )
    .all(valveId);
}

export function updateSetpoint(id: string, setpoint: number) {
  const stmt = db.prepare(`
    UPDATE valves SET setpoint = ? WHERE id = ?
  `);
  stmt.run(setpoint, id);
}
