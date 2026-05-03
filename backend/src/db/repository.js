import db from "./database.js";
const VALID_VALVE_ID = /^valve\d+$/i;
function isValidValveId(id) {
    return VALID_VALVE_ID.test(id);
}
// salva o aggiorna valvola
export function upsertValve(id, setpoint, heating, temperature, roomId, manualSetpoint) {
    const stmt = db.prepare(`
    INSERT INTO valves (id, setpoint, manual_setpoint, heating, status, last_seen, temperature, room_id)
    VALUES (?, ?, ?, 'ONLINE', CURRENT_TIMESTAMP, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      setpoint = excluded.setpoint,
      manual_setpoint = COALESCE(excluded.manual_setpoint, manual_setpoint),
      heating = excluded.heating,
      status = 'ONLINE',
      last_seen = CURRENT_TIMESTAMP,
      temperature = COALESCE(excluded.temperature, temperature),
      room_id = COALESCE(excluded.room_id, room_id)
  `);
    stmt.run(id, setpoint, manualSetpoint || null, heating ? 1 : 0, temperature || null, roomId || null);
}
// aggiorna lo status della valvola
export function updateValveStatus(id, status) {
    const stmt = db.prepare(`
    UPDATE valves SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?
  `);
    stmt.run(status, id);
}
// salva temperatura
export function insertTemperature(valveId, temperature) {
    const stmt = db.prepare(`
    INSERT INTO temperature_readings (valve_id, temperature)
    VALUES (?, ?)
  `);
    stmt.run(valveId, temperature);
}
// leggi tutte le valvole
export function getValves() {
    return db
        .prepare("SELECT * FROM valves")
        .all()
        .filter((valve) => isValidValveId(valve.id));
}
// storico temperatura
export function getTemperatureHistory(valveId) {
    if (!isValidValveId(valveId)) {
        return [];
    }
    return db
        .prepare("SELECT * FROM temperature_readings WHERE valve_id = ? ORDER BY timestamp DESC LIMIT 50")
        .all(valveId);
}
export function updateSetpoint(id, setpoint) {
    if (!isValidValveId(id)) {
        return;
    }
    const stmt = db.prepare(`
    UPDATE valves SET setpoint = ? WHERE id = ?
  `);
    stmt.run(setpoint, id);
}
// cancella valvola 
export function deleteValve(id) {
    if (!isValidValveId(id)) {
        return;
    }
    // elimina storico temperature
    db.prepare("DELETE FROM temperature_readings WHERE valve_id = ?").run(id);
    // elimina la valvola
    db.prepare("DELETE FROM valves WHERE id = ?").run(id);
}
// Funzioni per stanze
export function createRoom(id, name, description, globalSetpoint) {
    const stmt = db.prepare(`
    INSERT INTO rooms (id, name, description, global_setpoint)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(id, name, description || null, globalSetpoint || 20);
}
export function getRooms() {
    return db.prepare("SELECT * FROM rooms").all();
}
export function getRoomById(id) {
    return db.prepare("SELECT * FROM rooms WHERE id = ?").get(id);
}
export function updateRoomSetpoint(id, setpoint) {
    const stmt = db.prepare(`
    UPDATE rooms SET global_setpoint = ? WHERE id = ?
  `);
    stmt.run(setpoint, id);
}
export function assignValveToRoom(valveId, roomId) {
    if (!isValidValveId(valveId)) {
        return null;
    }
    const room = roomId ? getRoomById(roomId) : null;
    const setpoint = room?.global_setpoint ?? 20;
    const stmt = db.prepare(`
    INSERT INTO valves (id, setpoint, heating, status, last_seen, room_id)
    VALUES (?, ?, 0, 'OFFLINE', CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      setpoint = excluded.setpoint,
      room_id = excluded.room_id,
      last_seen = CURRENT_TIMESTAMP
  `);
    stmt.run(valveId, setpoint, roomId || null);
    return {
        roomId: roomId || null,
        setpoint
    };
}
export function getValvesByRoom(roomId) {
    return db
        .prepare("SELECT * FROM valves WHERE room_id = ?")
        .all(roomId)
        .filter((valve) => isValidValveId(valve.id));
}
export function getRoomAnalytics() {
    return db.prepare(`
    SELECT
      rooms.id,
      rooms.name,
      rooms.global_setpoint,
      COUNT(valves.id) AS valve_count,
      ROUND(AVG(COALESCE(valves.temperature, 0)), 2) AS avg_temperature,
      SUM(CASE WHEN valves.heating = 1 THEN 1 ELSE 0 END) AS heating_on_count
    FROM rooms
    LEFT JOIN valves ON valves.room_id = rooms.id
    GROUP BY rooms.id, rooms.name, rooms.global_setpoint
    ORDER BY rooms.name ASC
  `).all();
}
