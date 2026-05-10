import mqtt from "mqtt";
import dotenv from "dotenv";
import {
  upsertValve,
  insertTemperature,
  updateValveStatus,
  getRoomById,
  assignValveToRoom as persistValveRoomAssignment,
} from "../db/repository.js";
import db from "../db/database.js";
import { logEvent } from "../utils/logger.js";

dotenv.config();


const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const client = mqtt.connect(brokerUrl);
const VALID_VALVE_ID = /^valve\d+$/i;

// stato valvole
const valves: Record<string, { temperature: number; heating: boolean; setpoint: number; lastSeen: number; status: 'ONLINE' | 'OFFLINE'; roomId?: string }> = {};

// override manuale
interface Override {
  state: boolean;      // true = ON, false = OFF
  endTime: number;     // timestamp di scadenza
  timeoutId: NodeJS.Timeout;
}
const overrides: Record<string, Override> = {};

// setpoint di default + ISTERESI
const DEFAULT_SETPOINT = 20;
const HYSTERESIS = 1;
const OFFLINE_TIMEOUT = 30000; // 30 secondi senza dati = OFFLINE

/*
 Funzione che resetta lo stato di tutte le valvole a OFFLINE nel database all'avvio.
 Questo evita di mostrare come "ONLINE" valvole che erano attive,
 prima dell'ultimo spegnimento del controller.
 */
function resetAllValvesStatus() {
  try {
    const stmt = db.prepare("UPDATE valves SET status = 'OFFLINE'");
    const info = stmt.run();
    console.log(`🧹 Reset iniziale: ${info.changes} valvole impostate su OFFLINE nel database.`);
  } catch (err) {
    console.error("Errore durante il reset iniziale delle valvole:", err);
  }
}

// Esecuzione Imediata: Puliamo il DB appena il file viene caricato
resetAllValvesStatus();

client.on("connect", () => {
  console.log("✅ Controller connected to MQTT");

  // ascolta tutte le valvole
  client.subscribe("home/valves/+/temperature");
});

client.on("message", (topic, message) => {
  const data = JSON.parse(message.toString());

  //  Estrazione e validazione ID Valvola
  const match = topic.match(/home\/valves\/(.+)\/temperature/);
  if (!match) return;

  const valveId = match[1]!;
  if (!valveId || !VALID_VALVE_ID.test(valveId)) return;

  const temperature = parseFloat(data.temperature);
  
  // Flag di sincronizzazione: Questa variabile ci dice se dobbiamo forzare l'invio del comando MQTT
  let isReturningOnline = false; 

  // Gestione Stato Iniziale e Rientro Offline
  if (!valves[valveId]) {
    const valveFromDb = db.prepare("SELECT room_id FROM valves WHERE id = ?").get(valveId) as any;
    const roomId = valveFromDb?.room_id;
    let setpoint = DEFAULT_SETPOINT;
    if (roomId) {
      const room = getRoomById(roomId) as any;
      if (room) setpoint = room.global_setpoint;
    }
    // Creazione in RAM
    valves[valveId] = { temperature, heating: false, setpoint, lastSeen: Date.now(), status: 'ONLINE', roomId };
    upsertValve(valveId, setpoint, false, temperature, roomId);
    
    isReturningOnline = true; // Nuova valvola: allineiamo subito il simulatore
  } else {
    if (valves[valveId].status === 'OFFLINE') {
      valves[valveId].status = 'ONLINE';
      updateValveStatus(valveId, 'ONLINE');
      console.log(`✅ ${valveId}: BACK ONLINE - Sincronizzazione in corso...`);
      
      isReturningOnline = true; // Era offline: forziamo il comando per riallineare il simulatore fisico
    }
  }

  // Aggiornamento dati correnti
  valves[valveId].temperature = temperature;
  valves[valveId].lastSeen = Date.now();
  insertTemperature(valveId, temperature);

  console.log(`🌡️ [${valveId}] Temp: ${temperature}°C - Setpoint: ${valves[valveId].setpoint}°C`);

  // Gestione LOGICA (Override o Automatica)
  const now = Date.now();
  
  if (overrides[valveId] && overrides[valveId].endTime > now) {
    // --- LOGICA OVERRIDE ---
    const overrideState = overrides[valveId].state;
    const currentState = valves[valveId].heating;
    
    // Inviamo il comando se lo stato cambia O se la valvola è appena tornata online
    if (overrideState !== currentState || isReturningOnline) {
      valves[valveId].heating = overrideState;
      upsertValve(valveId, valves[valveId].setpoint, overrideState, temperature);
      client.publish(`home/valves/${valveId}/command`, JSON.stringify({ heating: overrideState }));
      console.log(`⚠️ [${valveId}] OVERRIDE FORZATO: heating = ${overrideState}`);
    }
  } else {
    // --- LOGICA AUTOMATICA (ISTERESI) ---
    if (overrides[valveId]) {
      clearTimeout(overrides[valveId].timeoutId);
      delete overrides[valveId];
      console.log(`🔄 [${valveId}] Override scaduto, ripresa logica automatica`);
    }

    const setpoint = valves[valveId].setpoint;
    let currentState = valves[valveId].heating;
    let newState = currentState;

    // Calcolo Isteresi
    if (temperature < setpoint - HYSTERESIS) {
      newState = true;
    } else if (temperature > setpoint + HYSTERESIS) {
      newState = false;
    }

    // --- DECISIONE DI INVIO COMANDO ---
    // Aggiungendo "|| isReturningOnline", risolviamo il bug del simulatore che non partiva
    if (newState !== currentState || isReturningOnline) {
      valves[valveId].heating = newState;
      upsertValve(valveId, setpoint, newState, temperature);
      
      const payload = JSON.stringify({ heating: newState });
      client.publish(`home/valves/${valveId}/command`, payload);

      console.log(`🔥 [${valveId}] COMANDO INVIATO: heating = ${newState} (Motivo: ${isReturningOnline ? 'Sincro Online' : 'Cambio Temp'})`);
    } else {
      console.log(`⏸️ [${valveId}] Stato invariato (${temperature}°C)`);
    }
  }
});

// Funzioni esportate per gestire gli override
export function setOverride(valveId: string, state: boolean, durationSeconds: number): boolean {
  if (!valves[valveId]) {
    return false; // valvola non trovata
  }

  // rimuovi override precedente se esiste
  if (overrides[valveId]) {
    clearTimeout(overrides[valveId].timeoutId);
  }

  const endTime = Date.now() + durationSeconds * 1000;

  // crea il timeout che rimuove l'override
  const timeoutId = setTimeout(() => {
    delete overrides[valveId];
    console.log(`⏰ Override per ${valveId} scaduto`);
  }, durationSeconds * 1000);

  overrides[valveId] = { state, endTime, timeoutId };

  // pubblica subito il comando
  const payload = JSON.stringify({ heating: state });
  client.publish(`home/valves/${valveId}/command`, payload);

  console.log(`✅ Override attivato: ${valveId} = ${state} per ${durationSeconds}s`);
  return true;
}

export function getActiveOverrides() {
  const now = Date.now();
  const active: Record<string, { state: boolean; remainingSeconds: number }> = {};

  for (const [valveId, override] of Object.entries(overrides)) {
    if (override.endTime > now) {
      active[valveId] = {
        state: override.state,
        remainingSeconds: Math.ceil((override.endTime - now) / 1000)
      };
    }
  }

  return active;
}

export function cancelOverride(valveId: string): boolean {
  if (overrides[valveId]) {
    clearTimeout(overrides[valveId].timeoutId);
    delete overrides[valveId];
    console.log(`❌ Override cancellato per ${valveId}`);
    return true;
  }
  return false;
}

export function assignValveRoom(valveId: string, roomId?: string | null) {
  if (!VALID_VALVE_ID.test(valveId)) {
    return null;
  }

  const assignment = persistValveRoomAssignment(valveId, roomId || "");
  if (!assignment) {
    return null;
  }

  // log lato runtime (solo se effetto/room è presente in memoria)
  if (assignment.roomId) {
    logEvent("VALVE_ASSIGNED", { valveId, roomId: assignment.roomId, setpoint: assignment.setpoint });
  } else {
    logEvent("VALVE_DETACHED", { valveId, roomId: null, setpoint: assignment.setpoint });
  }

  const valve = valves[valveId];
  if (valve) {
    valve.roomId = assignment.roomId || undefined;
    valve.setpoint = assignment.setpoint;
    upsertValve(
      valveId,
      assignment.setpoint,
      valve.heating,
      valve.temperature,
      assignment.roomId || undefined
    );
  }

  return assignment;
}


// Controlla periodicamente se ci sono valvole offline
setInterval(() => {
  const now = Date.now();

  for (const [valveId, valve] of Object.entries(valves)) {
    if (valve.status === 'ONLINE' && now - valve.lastSeen > OFFLINE_TIMEOUT) {
      valve.status = 'OFFLINE';
      updateValveStatus(valveId, 'OFFLINE');
      console.log(`⚫ ${valveId}: OFFLINE (nessun dato per ${Math.floor((now - valve.lastSeen) / 1000)}s)`);
    }
  }
}, 10000); // verifica ogni 10 secondi

// funzione di rimozione della valvola 
export function removeValve(valveId: string) {
  // rimuovi override se presente
  if (overrides[valveId]) {
    clearTimeout(overrides[valveId].timeoutId);
    delete overrides[valveId];
  }

  // rimuovi la valvola dalla memoria del controller
  if (valves[valveId]) {
    delete valves[valveId];
  }

  console.log(`🗑️ Valvola ${valveId} rimossa dal controller`);
  logEvent("VALVE_REMOVED_FROM_CONTROLLER", { valveId });
}


export function updateManualSetpoint(valveId: string, newSetpoint: number) {
  if (valves[valveId]) {
    valves[valveId].setpoint = newSetpoint;
    console.log(`🎯 Controller: Setpoint aggiornato in memoria per ${valveId} a ${newSetpoint}°C`);
    logEvent("SETPOINT_CHANGED", { valveId, setpoint: newSetpoint, manual: true });
  }
}

