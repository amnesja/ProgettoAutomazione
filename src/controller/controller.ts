import mqtt from "mqtt";
import dotenv from "dotenv";
import db from "../db/database.js";
import { logEvent } from "../utils/logger.js";
import {upsertValve, insertTemperature, updateValveStatus, getValveById, assignValveToRoom as persistValveRoomAssignment, } from "../db/repository.js";

dotenv.config();

//  CONFIGURAZIONI E STATO IN RAM 
const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const WOT_HTTP_URL = `http://localhost:${process.env.WOT_PORT || 8081}`;
const client = mqtt.connect(brokerUrl);

const DEFAULT_SETPOINT = 20;
const HYSTERESIS = 1;
const OFFLINE_TIMEOUT = 30000; 

// Specchio locale dello stato delle Thing WoT
const valves: Record<string, { temperature: number; heating: boolean; setpoint: number; lastSeen: number; status: 'ONLINE' | 'OFFLINE'; roomId?: string }> = {};

interface Override { state: boolean; endTime: number; timeoutId: NodeJS.Timeout; }
const overrides: Record<string, Override> = {};

// Reset iniziale dello stato nel DB al boot
(function resetAllValvesStatus() {
  try {
    db.prepare("UPDATE valves SET status = 'OFFLINE'").run();
    console.log("🧹 DB local: Stato valvole resettato a OFFLINE.");
  } catch (err) {
    console.error("Errore reset iniziale DB:", err);
  }
})();

// GESTIONE BOOT E SCOPERTA THING

async function initializeValvesFromList(activeValves: string[]) {
  for (const valveId of activeValves) {
    if (valves[valveId]) continue;

    console.log(`[WoT Consumer] Rilevata Thing: ${valveId}. Avvio monitoraggio...`);
    
    // Interroghiamo il DB usando la funzione esportata dal repository!
    const valveFromDb = getValveById(valveId) as any;
    const roomId = valveFromDb?.room_id || undefined; // Se c'è la stanza la prende, altrimenti undefined
    
    let setpoint = DEFAULT_SETPOINT; // Fallback di fabbrica

    //Leggiamo il setpoint REALE e aggiornato direttamente dal Server WoT
    try {
      const response = await fetch(`${WOT_HTTP_URL}/valve-${valveId}/properties/setpoint`);
      if (response.ok) {
        setpoint = await response.json() as number;
        console.log(`[WoT Consumer] Setpoint reale letto dal WoT per ${valveId}: ${setpoint}°C`);
      }
    } catch (err) {
      // Se il WoT non risponde, proviamo ad usare il setpoint memorizzato nel DB come paracadute
      if (valveFromDb?.setpoint) {
        setpoint = valveFromDb.setpoint;
      }
      console.warn(`⚠️ Impossibile leggere dal WoT per ${valveId}, uso il valore del DB o di default.`);
    }

    // Inizializziamo le valvole in RAM 
    valves[valveId] = { 
      temperature: 20.0, 
      heating: false, 
      setpoint, 
      lastSeen: Date.now(), 
      status: 'ONLINE', 
      roomId 
    };
    
    // Iscrizione ai topic per i futuri aggiornamenti in tempo reale
    client.subscribe(`valve-${valveId}/properties/temperature`);
    client.subscribe(`valve-${valveId}/properties/setpoint`);
  }
}

client.on("connect", async () => {
  console.log("🎮 Controller connesso al Broker MQTT");

  // Ascolto dinamico nuove Thing dalla Directory via MQTT
  client.subscribe("ValveDirectory/properties/valves");

  // Sincronizzazione iniziale al boot dalla Directory via HTTP Fetch
  try {
    const response = await fetch(`${WOT_HTTP_URL}/valvedirectory/properties/valves`);
    if (response.ok) {
      const activeValves = await response.json() as string[];
      initializeValvesFromList(activeValves);
    }
  } catch (err) {
    console.warn("⚠️ Directory WoT non raggiungibile via HTTP al boot. In attesa di MQTT...");
  }
});

// ASCOLTO AGGIORNAMENTI PROPRIETÀ 

client.on("message", (topic, message) => {
  try {
    const payload = message.toString().trim();

    // Aggiornamento lista valvole dalla Directory
    if (topic === "ValveDirectory/properties/valves") {
      initializeValvesFromList(JSON.parse(payload));
      return;
    }

    // Parsing delle proprietà delle singole valvole
    const match = topic.match(/^valve-(valve\d+)\/properties\/(temperature|setpoint)$/);
    if (!match) return;

    const [, valveId, property] = match;
    if (!valves[valveId]) return;

    let isReturningOnline = false;

    // Gestione transizione OFFLINE -> ONLINE
    if (valves[valveId].status === 'OFFLINE') {
      valves[valveId].status = 'ONLINE';
      updateValveStatus(valveId, 'ONLINE');
      isReturningOnline = true; 
    }
    
    valves[valveId].lastSeen = Date.now();

    // Aggiornamento dello specchio in RAM
    if (property === "temperature") {
      valves[valveId].temperature = parseFloat(payload);
      insertTemperature(valveId, valves[valveId].temperature); // Storico su DB
    } else if (property === "setpoint") {
      valves[valveId].setpoint = parseFloat(payload);
    }

    console.log(`[RAM Update] ${valveId} -> Temp: ${valves[valveId].temperature}°C | Heating: ${valves[valveId].heating} | Setpoint: ${valves[valveId].setpoint}°C`);

    // Elabora la logica ad ogni variazione ricevuta
    executeControlLogic(valveId, isReturningOnline);

  } catch (err) {
    console.error("❌ Errore processing messaggio MQTT:", err);
  }
});

// CORE LOGICO E INVOCAZIONE AZIONI

function executeControlLogic(valveId: string, isReturningOnline: boolean) {
  const valve = valves[valveId];
  const now = Date.now();

  // Caso A: Gestione manuale tramite Override attivo (Copiato fedelmente dal vecchio progetto)
  if (overrides[valveId] && overrides[valveId].endTime > now) {
    const overrideState = overrides[valveId].state;
    const currentState = valve.heating;

    if (overrideState !== currentState || isReturningOnline) {
      valve.heating = overrideState;
      upsertValve(valveId, valve.setpoint, overrideState, valve.temperature); // salviamo o aggiorniamo la valvola nel db 
      invokeWotAction(valveId, "setHeating", overrideState);
      console.log(`⚠️ [${valveId}] OVERRIDE FORZATO: heating = ${overrideState}`);
    }
  } 
  // Caso B: Logica automatica tramite Isteresi
  else {
    if (overrides[valveId]) {
      clearTimeout(overrides[valveId].timeoutId);
      delete overrides[valveId];
      console.log(`🔄 [${valveId}] Override scaduto, ripresa logica automatica`);
    }

    const setpoint = valve.setpoint;
    const currentState = valve.heating;
    let newState = currentState;

    if (valve.temperature < setpoint - HYSTERESIS) {
      newState = true;
    } else if (valve.temperature > setpoint + HYSTERESIS) {
      newState = false;
    }

    if (newState !== currentState || isReturningOnline) {
      valve.heating = newState;
      upsertValve(valveId, setpoint, newState, valve.temperature);
      invokeWotAction(valveId, "setHeating", newState);
      console.log(`🔥 [${valveId}] COMANDO INVIATO: heating = ${newState}`);
    }
  }
}

// Funzione centralizzata per invocare le Action del WoT via HTTP POST Fetch
async function invokeWotAction(valveId: string, actionName: string, payload: any) {
  try {
    await fetch(`${WOT_HTTP_URL}/valve-${valveId}/actions/${actionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`🚀 [WoT Action] Invocata con successo l'azione '${actionName}' per ${valveId} con valore: ${payload}`);
  } catch (err: any) {
    console.error(`❌ [WoT Action Error] Fallita invocazione '${actionName}' per ${valveId}:`, err.message);
  }
}

// INTERFACCE E METODI ESPORTATI ---

export function setOverride(valveId: string, state: boolean, durationSeconds: number): boolean {
  if (!valves[valveId]) return false;

  if (overrides[valveId]) clearTimeout(overrides[valveId].timeoutId);

  const endTime = Date.now() + durationSeconds * 1000;
  const timeoutId = setTimeout(() => {
    delete overrides[valveId];
    console.log(`⏰ Override scaduto per ${valveId}`);
    // Quando scade, forziamo il rinfresco immediato per far ripartire l'isteresi automatica
    executeControlLogic(valveId, false);
  }, durationSeconds * 1000);

  overrides[valveId] = { state, endTime, timeoutId };

  // Allineiamo subito la RAM locale e salviamo sul DB
  valves[valveId].heating = state;
  upsertValve(valveId, valves[valveId].setpoint, state, valves[valveId].temperature);

  // Pubblica subito l'azione HTTP single-shot
  invokeWotAction(valveId, "setHeating", state);
  console.log(`✅ Override attivato: ${valveId} = ${state} per ${durationSeconds}s`);
  return true;
}

export function getActiveOverrides() {
  const now = Date.now();
  const active: Record<string, { state: boolean; remainingSeconds: number }> = {};
  for (const [valveId, override] of Object.entries(overrides)) {
    if (override.endTime > now) {
      active[valveId] = { state: override.state, remainingSeconds: Math.ceil((override.endTime - now) / 1000) };
    }
  }
  return active;
}

export function cancelOverride(valveId: string): boolean {
  if (!overrides[valveId]) return false;
  clearTimeout(overrides[valveId].timeoutId);
  delete overrides[valveId];
  // Forza il riallineamento immediato all'automatismo dopo la cancellazione
  executeControlLogic(valveId, false);
  return true;
}

export function assignValveRoom(valveId: string, roomId?: string | null) {
  const VALID_VALVE_ID = /^valve\d+$/i;
  if (!VALID_VALVE_ID.test(valveId)) return null;

  const assignment = persistValveRoomAssignment(valveId, roomId || "");
  if (!assignment) return null;

  logEvent(assignment.roomId ? "VALVE_ASSIGNED" : "VALVE_DETACHED", { valveId, roomId: assignment.roomId || null, setpoint: assignment.setpoint });

  const valve = valves[valveId];
  if (valve) {
    valve.roomId = assignment.roomId || undefined;
    valve.setpoint = assignment.setpoint;
    upsertValve(valveId, assignment.setpoint, valve.heating, valve.temperature, assignment.roomId || undefined);
    updateManualSetpointInternal(valveId, assignment.setpoint, true);
  }
  return assignment;
}

export function removeValve(valveId: string) {
  cancelOverride(valveId);
  if (valves[valveId]) {
    delete valves[valveId];
    client.unsubscribe(`valve-${valveId}/properties/temperature`);
    client.unsubscribe(`valve-${valveId}/properties/setpoint`);
  }
  logEvent("VALVE_REMOVED_FROM_CONTROLLER", { valveId });
}

function updateManualSetpointInternal(valveId: string, newSetpoint: number, shouldLog: boolean) {
  if (valves[valveId]) {
    valves[valveId].setpoint = newSetpoint;
    invokeWotAction(valveId, "setTargetTemperature", newSetpoint);
    if (shouldLog) logEvent("SETPOINT_CHANGED", { valveId, setpoint: newSetpoint, manual: true });
  }
}

export function updateManualSetpoint(valveId: string, newSetpoint: number) {
  updateManualSetpointInternal(valveId, newSetpoint, true);
}

// Controllo ciclico liveness valvole (Heartbeat)
setInterval(() => {
  const now = Date.now();
  for (const [valveId, valve] of Object.entries(valves)) {
    if (valve.status === 'ONLINE' && now - valve.lastSeen > OFFLINE_TIMEOUT) {
      valve.status = 'OFFLINE';
      updateValveStatus(valveId, 'OFFLINE');
      console.log(`⚫ ${valveId}: Rilevata OFFLINE per inattività.`);
    }
  }
}, 10000);