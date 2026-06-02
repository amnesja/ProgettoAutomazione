import db from "./database.js";
import { logEvent } from "../utils/logger.js";


const VALID_VALVE_ID = /^valve\d+$/i;

function isValidValveId(id: string) {
  return VALID_VALVE_ID.test(id);
}

// salva o aggiorna valvola
export function upsertValve(id: string, setpoint: number, heating: boolean, temperature?: number, roomId?: string) {
  const stmt = db.prepare(`
    INSERT INTO valves (id, setpoint, heating, status, last_seen, temperature, room_id)
    VALUES (?, ?, ?, 'ONLINE', CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      setpoint = excluded.setpoint,
      heating = excluded.heating,
      status = 'ONLINE',
      last_seen = CURRENT_TIMESTAMP,
      temperature = COALESCE(excluded.temperature, temperature),
      room_id = COALESCE(excluded.room_id, room_id)
  `);

  stmt.run(id, setpoint, heating ? 1 : 0, temperature || null, roomId || null);
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
  return db
    .prepare("SELECT * FROM valves")
    .all()
    .filter((valve: any) => isValidValveId(valve.id));
}

// mappa la singola valvola
export function getValveById(id: string) {
  if (!isValidValveId(id)) {
    return null;
  }
  return db.prepare("SELECT setpoint, room_id FROM valves WHERE id = ?").get(id);
}

// storico temperatura
export function getTemperatureHistory(valveId: string) {
  if (!isValidValveId(valveId)) {
    return [];
  }

  return db
    .prepare(
      "SELECT * FROM temperature_readings WHERE valve_id = ? ORDER BY timestamp DESC LIMIT 50"
    )
    .all(valveId);
}

export function updateSetpoint(id: string, setpoint: number) {
  if (!isValidValveId(id)) {
    return;
  }

  const stmt = db.prepare(`
    UPDATE valves SET setpoint = ? WHERE id = ?
  `);
  stmt.run(setpoint, id);

  logEvent("SETPOINT_CHANGED", { valveId: id, setpoint, manual: false });
}


// cancella valvola 
export function deleteValve(id: string) {
  if (!isValidValveId(id)) {
    return;
  }

  // elimina storico temperature
  db.prepare("DELETE FROM temperature_readings WHERE valve_id = ?").run(id);

  // elimina la valvola
  db.prepare("DELETE FROM valves WHERE id = ?").run(id);

  logEvent("VALVE_DELETED", { valveId: id });
}



// Funzioni per stanze
export function createRoom(id: string, name: string, description?: string, globalSetpoint?: number) {
  const stmt = db.prepare(`
    INSERT INTO rooms (id, name, description, global_setpoint)
    VALUES (?, ?, ?, ?)
  `);

  const setpoint = globalSetpoint || 20;
  stmt.run(id, name, description || null, setpoint);

  logEvent("ROOM_CREATED", { roomId: id, name, setpoint });
}


export function getRooms() {
  return db.prepare("SELECT * FROM rooms").all();
}

export function getRoomById(id: string) {
  return db.prepare("SELECT * FROM rooms WHERE id = ?").get(id);
}

export function updateRoomSetpoint(id: string, setpoint: number) {
  const stmt = db.prepare(`
    UPDATE rooms SET global_setpoint = ? WHERE id = ?
  `);
  stmt.run(setpoint, id);
}

export function assignValveToRoom(valveId: string, roomId: string) {
  if (!isValidValveId(valveId)) {
    return null;
  }

  const room = roomId ? getRoomById(roomId) as any : null;
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

  const assignedRoomId = roomId || null;

  if (assignedRoomId) {
    logEvent("VALVE_ASSIGNED", { valveId, roomId: assignedRoomId, setpoint });
  } else {
    logEvent("VALVE_DETACHED", { valveId, roomId: null, setpoint });
  }

  return {
    roomId: assignedRoomId,
    setpoint,
  };
}


export function getValvesByRoom(roomId: string) {
  return db
    .prepare("SELECT * FROM valves WHERE room_id = ?")
    .all(roomId)
    .filter((valve: any) => isValidValveId(valve.id));
}

export function getRoomAnalytics() {
  return db.prepare(`
    SELECT
      rooms.id,
      rooms.name,
      rooms.global_setpoint,
      COUNT(valves.id) AS valve_count,
      ROUND(AVG(valves.temperature), 2) AS avg_temperature,
      SUM(CASE WHEN valves.heating = 1 THEN 1 ELSE 0 END) AS heating_on_count
    FROM rooms
    LEFT JOIN valves ON valves.room_id = rooms.id
    GROUP BY rooms.id, rooms.name, rooms.global_setpoint
    ORDER BY rooms.name ASC
  `).all();
}

// Cancella una stanza e scollega le valvole

export function deleteRoom(id: string) {
  // Scolleghiamo le valvole associate alla stanza (impostando room_id a NULL)
  const detachValves = db.prepare(`
    UPDATE valves SET room_id = NULL WHERE room_id = ?
  `);
  detachValves.run(id);

  // Eliminiamo la stanza
  const deleteStmt = db.prepare(`
    DELETE FROM rooms WHERE id = ?
  `);

  const res = deleteStmt.run(id);
  logEvent("ROOM_DELETED", { roomId: id, deleted: res.changes ?? null });

  return res;
}

