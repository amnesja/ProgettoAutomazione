import db from "./database.js";

// salva o aggiorna valvola
export function upsertValve(id: string, setpoint: number, heating: boolean) {
  const stmt = db.prepare(`
    INSERT INTO valves (id, setpoint, heating)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      setpoint = excluded.setpoint,
      heating = excluded.heating
  `);

  stmt.run(id, setpoint, heating ? 1 : 0);
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