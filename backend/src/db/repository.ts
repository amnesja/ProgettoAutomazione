import db from "./database.js";

const VALID_VALVE_ID = /^valve\d+$/i;

function isValidValveId(id: string) {
  return VALID_VALVE_ID.test(id);
}

// salva o aggiorna valvola
export function upsertValve(id: string, setpoint: number, heating: boolean, temperature?: number, roomId?: string, manualSetpoint?: number | null) {
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

// aggiorna lo status della valvola (e resetta heating quando va offline)
export function updateValveStatus(id: string, status: 'ONLINE' | 'OFFLINE') {
  const stmt = db.prepare(`
    UPDATE valves SET status = ?, last_seen = CURRENT_TIMESTAMP${status === 'OFFLINE' ? ', heating = 0' : ''} WHERE id = ?
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

// DEPRECATED: use controller.setManualSetpoint for new setpoints
export function updateSetpoint(id: string, setpoint: number) {
  if (!isValidValveId(id)) {
    return;
  }

  const stmt = db.prepare(`
    UPDATE valves SET setpoint = ? WHERE id = ?
  `);
  stmt.run(setpoint, id);
}

export function setValveManualSetpoint(id: string, setpoint: number) {
  if (!isValidValveId(id)) {
    return false;
  }
  const stmt = db.prepare(`
    UPDATE valves SET setpoint = ?, manual_setpoint = ? WHERE id = ?
  `);
  const result = stmt.run(setpoint, setpoint, id);
  return result.changes > 0;
}

export function getValveManualSetpoint(id: string): number | null {
  if (!isValidValveId(id)) {
    return null;
  }
  const row = db.prepare("SELECT manual_setpoint FROM valves WHERE id = ?").get(id) as { manual_setpoint: number } | undefined | null;
  return row?.manual_setpoint ?? null;
}

export function clearValveManualSetpoint(id: string): boolean {
  if (!isValidValveId(id)) {
    return false;
  }
  const stmt = db.prepare("UPDATE valves SET manual_setpoint = NULL WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function propagateRoomSetpoint(roomId: string): number {
  const room = getRoomById(roomId) as { global_setpoint?: number } | undefined;
  if (!room?.global_setpoint) {
    throw new Error(`Invalid room "${roomId}" or missing global_setpoint`);
  }

  const setpoint = room.global_setpoint;
  const stmt = db.prepare(`
    UPDATE valves SET setpoint = ? WHERE room_id = ?
  `);
  const result = stmt.run(setpoint, roomId);
  console.log(`🔄 Propagated ${setpoint}°C to ${result.changes || 0} valves in room "${roomId}"`);
  return result.changes || 0;
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
}


// Funzioni per stanze
export function createRoom(id: string, name: string, description?: string, globalSetpoint?: number) {
  const stmt = db.prepare(`
    INSERT INTO rooms (id, name, description, global_setpoint)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, name, description || null, globalSetpoint || 20);
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


export function assignValveToRoom(valveId: string, roomId: string | null) {
  if (!isValidValveId(valveId)) {
    return null;
  }

    if (roomId) {
      const room = getRoomById(roomId) as any;
      const setpoint = room?.global_setpoint ?? 20;

      const stmt = db.prepare(`
        INSERT INTO valves (id, setpoint, manual_setpoint, heating, status, last_seen, room_id)
        VALUES (?, ?, NULL, 0, 'OFFLINE', CURRENT_TIMESTAMP, ?)
        ON CONFLICT(id) DO UPDATE SET
          setpoint = excluded.setpoint,
          manual_setpoint = NULL,
          room_id = excluded.room_id,
          last_seen = CURRENT_TIMESTAMP
      `);
      stmt.run(valveId, setpoint, roomId);

      return {
        roomId,
        setpoint
      };
    } else {
    // Unassign: remove room_id, keep setpoint
    const stmt = db.prepare("UPDATE valves SET room_id = NULL WHERE id = ?");
    stmt.run(valveId);

    const currentValve = db.prepare("SELECT setpoint FROM valves WHERE id = ?").get(valveId) as { setpoint: number } | undefined;
    const setpoint = currentValve?.setpoint ?? 20;

    return {
      roomId: null,
      setpoint
    };
  }
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
      ROUND(AVG(COALESCE(valves.temperature, 0)), 2) AS avg_temperature,
      SUM(CASE WHEN valves.heating = 1 THEN 1 ELSE 0 END) AS heating_on_count
    FROM rooms
    LEFT JOIN valves ON valves.room_id = rooms.id
    GROUP BY rooms.id, rooms.name, rooms.global_setpoint
    ORDER BY rooms.name ASC
  `).all();
}

// delete room
export function deleteRoom(id: string) {
  // rimuovi assegnazione valvole alla stanza
  db.prepare("UPDATE valves SET room_id = NULL WHERE room_id = ?").run(id);

  // elimina la stanza
  db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
}


