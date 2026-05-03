import mqtt from "mqtt";
import dotenv from "dotenv";
import { upsertValve, insertTemperature, updateValveStatus, getRoomById, assignValveToRoom as persistValveRoomAssignment, setValveManualSetpoint, getValveManualSetpoint, clearValveManualSetpoint } from "../db/repository.js";
import db from "../db/database.js";
import { fileURLToPath } from "url";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const VALID_VALVE_ID = /^valve\d+$/i;

type ValveStatus = "ONLINE" | "OFFLINE";

// stato valvole (in-memory)
const valves: Record<
  string,
  {
    temperature: number;
    heating: boolean;
    setpoint: number;
    lastSeen: number;
    status: ValveStatus;
    roomId?: string;
    manualSetpoint?: boolean;
  }
> = {};

// override manuale (in-memory)
interface Override {
  state: boolean; // true = ON, false = OFF
  endTime: number; // timestamp di scadenza
  timeoutId: NodeJS.Timeout;
}
const overrides: Record<string, Override> = {};

// MQTT client inizializzato solo quando avvii il controller
let mqttClient: mqtt.MqttClient | null = null;
let offlineIntervalId: NodeJS.Timeout | null = null;

const DEFAULT_SETPOINT = 20;
const HYSTERESIS = 1;
const OFFLINE_TIMEOUT = 30000; // 30 secondi senza dati = OFFLINE

function publishHeatingCommand(valveId: string, heating: boolean) {
  if (!mqttClient) return;
  const payload = JSON.stringify({ heating });
  mqttClient.publish(`home/valves/${valveId}/command`, payload);
}

function setupOfflineWatcher() {
  if (offlineIntervalId) return;

  offlineIntervalId = setInterval(() => {
    const now = Date.now();

    for (const [valveId, valve] of Object.entries(valves)) {
      if (valve.status === "ONLINE" && now - valve.lastSeen > OFFLINE_TIMEOUT) {
        valve.status = "OFFLINE";
        updateValveStatus(valveId, "OFFLINE");
        console.log(`⚫ ${valveId}: OFFLINE (nessun dato per ${Math.floor((now - valve.lastSeen) / 1000)}s)`);
      }
    }
  }, 10000); // verifica ogni 10 secondi
}

export function startController() {
  if (mqttClient) return mqttClient; // già avviato

  mqttClient = mqtt.connect(brokerUrl);

  mqttClient.on("connect", () => {
    console.log("✅ Controller connected to MQTT");
    mqttClient?.subscribe("home/valves/+/temperature");
  });

  mqttClient.on("message", (topic, message) => {
    const data = JSON.parse(message.toString());

    const match = topic.match(/home\/valves\/(.+)\/temperature/);
    if (!match) return;

    const valveId = match[1]!;
    if (!valveId) return;

    if (!VALID_VALVE_ID.test(valveId)) {
      console.warn(`Ignoring invalid valve id: ${valveId}`);
      return;
    }

    const temperature = parseFloat(data.temperature);

    if (!valves[valveId]) {
      const valveFromDb = db.prepare("SELECT room_id FROM valves WHERE id = ?").get(valveId) as { room_id?: string } | undefined;
      const roomId = valveFromDb?.room_id;

      let setpoint = DEFAULT_SETPOINT;
      if (roomId) {
        const room = getRoomById(roomId) as { global_setpoint?: number } | undefined;
        if (room) setpoint = room.global_setpoint ?? DEFAULT_SETPOINT;
      }

      // Calcola heating iniziale basandosi su temperatura vs setpoint
      const shouldHeat = temperature < setpoint - HYSTERESIS;

      valves[valveId] = {
        temperature,
        heating: shouldHeat,
        setpoint,
        lastSeen: Date.now(),
        status: "ONLINE",
        roomId
      };

      upsertValve(valveId, setpoint, shouldHeat, temperature, roomId);
      if (shouldHeat) {
        publishHeatingCommand(valveId, true);
      }
    } else {
      if (valves[valveId].status === "OFFLINE") {
        valves[valveId].status = "ONLINE";
        updateValveStatus(valveId, "ONLINE");
        console.log(`✅ ${valveId}: BACK ONLINE`);
      }
    }

    valves[valveId].temperature = temperature;
    valves[valveId].lastSeen = Date.now();

    insertTemperature(valveId, temperature);

console.log(`🌡️ ${valveId}: ${temperature}°C`);

      // Sync setpoint from room if assigned and no manual override in DB
      if (!valves[valveId].roomId) {
        const valveFromDb = db.prepare("SELECT room_id FROM valves WHERE id = ?").get(valveId) as { room_id?: string } | undefined;
        valves[valveId].roomId = valveFromDb?.room_id || undefined;
      }

      const roomId = valves[valveId].roomId;
      const manualFromDb = getValveManualSetpoint(valveId);
      if (roomId) {
        // Prioritize room setpoint if assigned
        const room = getRoomById(roomId) as { global_setpoint?: number } | undefined;
        const roomSetpoint = room?.global_setpoint ?? DEFAULT_SETPOINT;
        if (Math.abs(valves[valveId].setpoint - roomSetpoint) > 0.01 || manualFromDb !== null) {
          if (manualFromDb !== null) {
            clearValveManualSetpoint(valveId);
            console.log(`🧹 ${valveId}: cleared stale manual_setpoint for room "${roomId}"`);
          }
          console.log(`🔄 ${valveId}: sync setpoint to room "${roomId}" → ${roomSetpoint}°C (was ${valves[valveId].setpoint}°C)`);
          valves[valveId].setpoint = roomSetpoint;
          valves[valveId].manualSetpoint = false;
          upsertValve(valveId, roomSetpoint, valves[valveId].heating, valves[valveId].temperature, roomId, null);
        }
      } else if (manualFromDb !== null) {
        // Use manual only if no room
        if (Math.abs(valves[valveId].setpoint - manualFromDb) > 0.01) {
          console.log(`📋 ${valveId}: using manual setpoint ${manualFromDb}°C from DB (no room)`);
          valves[valveId].setpoint = manualFromDb;
          valves[valveId].manualSetpoint = true;
        }
      }

const now = Date.now();

    // CONTROLLA SE C'È UN OVERRIDE ATTIVO
    if (overrides[valveId] && overrides[valveId].endTime > now) {
      const overrideState = overrides[valveId].state;
      const currentState = valves[valveId].heating;

      if (overrideState !== currentState) {
        valves[valveId].heating = overrideState;
        upsertValve(valveId, valves[valveId].setpoint, overrideState, temperature);
        publishHeatingCommand(valveId, overrideState);

        console.log(
          `⚠️ OVERRIDE ${valveId}: heating = ${overrideState} (scade in ${Math.floor((overrides[valveId].endTime - now) / 1000)}s)`
        );
      } else {
        console.log(
          `⚠️ OVERRIDE ${valveId}: heating = ${overrideState} (scade in ${Math.floor((overrides[valveId].endTime - now) / 1000)}s)`
        );
      }

      return;
    }

    // override scaduto o non esiste
    if (overrides[valveId]) {
      clearTimeout(overrides[valveId].timeoutId);
      delete overrides[valveId];
      console.log(`🔄 ${valveId}: override scaduto, logica automatica ripresa`);
    }

    // LOGICA CON ISTERESI
    const setpoint = valves[valveId].setpoint;
    const currentState = valves[valveId].heating;
    let newState = currentState;

    if (temperature < setpoint - HYSTERESIS) {
      newState = true;
    } else if (temperature > setpoint + HYSTERESIS) {
      newState = false;
    }

    if (newState !== currentState) {
      valves[valveId].heating = newState;
      upsertValve(valveId, setpoint, newState, temperature);
      publishHeatingCommand(valveId, newState);
      console.log(`🔥 ${valveId}: heating = ${newState}`);
    } else {
      console.log(`⏸️ ${valveId}: no change (${temperature}°C)`);
    }
  });

  setupOfflineWatcher();

  return mqttClient;
}

// Funzioni esportate per gestire gli override
export function setOverride(valveId: string, state: boolean, durationSeconds: number): boolean {
  if (!valves[valveId]) return false;

  if (overrides[valveId]) clearTimeout(overrides[valveId].timeoutId);

  const endTime = Date.now() + durationSeconds * 1000;

  const timeoutId = setTimeout(() => {
    delete overrides[valveId];
    console.log(`⏰ Override per ${valveId} scaduto`);
  }, durationSeconds * 1000);

  overrides[valveId] = { state, endTime, timeoutId };

  valves[valveId].heating = state;
  upsertValve(valveId, valves[valveId].setpoint, state, valves[valveId].temperature);

  // pubblica subito il comando (se MQTT è già avviato)
  publishHeatingCommand(valveId, state);

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
  if (!overrides[valveId]) return false;

  clearTimeout(overrides[valveId].timeoutId);
  delete overrides[valveId];
  console.log(`❌ Override cancellato per ${valveId}`);
  return true;
}

export function assignValveRoom(valveId: string, roomId?: string | null) {
  if (!VALID_VALVE_ID.test(valveId)) return null;

  const assignment = persistValveRoomAssignment(valveId, roomId || "");
  if (!assignment) return null;

  const valve = valves[valveId];
  if (valve) {
    valve.roomId = assignment.roomId || undefined;
    valve.setpoint = assignment.setpoint;

    // Ricalcola heating basandosi sul nuovo setpoint (con isteresi)
    const shouldHeat = valve.temperature < valve.setpoint - HYSTERESIS;
    const newHeating = valve.heating !== shouldHeat ? shouldHeat : valve.heating;

    // Aggiorna solo se lo stato è cambiato
    if (newHeating !== valve.heating) {
      valve.heating = newHeating;
      publishHeatingCommand(valveId, newHeating);
      console.log(`🔥 ${valveId}: heating ricalcolato = ${newHeating} (setpoint=${valve.setpoint}°C, temp=${valve.temperature}°C)`);
    }

    upsertValve(valveId, assignment.setpoint, valve.heating, valve.temperature, assignment.roomId || undefined);
  } else {
    // Valvola non ancora nel controller - non possiamo impostare setpoint ora
    // Sarà impostato quando la valvola invierà i primi dati
    console.log(`ℹ️ ${valveId}: valvola non ancora attiva, setpoint = ${assignment.setpoint} sarà applicato quando riceverà dati`);
  }

  return assignment;
}

export function setManualSetpoint(valveId: string, setpoint: number): boolean {
  // Persist to DB first
  const success = setValveManualSetpoint(valveId, setpoint);
  if (!success) {
    console.log(`❌ ${valveId}: failed to set manual setpoint in DB`);
    return false;
  }

  // Update in-memory if valve active
  if (valves[valveId]) {
    valves[valveId].setpoint = setpoint;
    valves[valveId].manualSetpoint = true;
    upsertValve(valveId, setpoint, valves[valveId].heating, valves[valveId].temperature, valves[valveId].roomId, setpoint);
  } else {
    // Load/init from DB for consistency
    const valveFromDb = db.prepare("SELECT * FROM valves WHERE id = ?").get(valveId) as any;
    valves[valveId] = {
      temperature: valveFromDb?.temperature || 20,
      heating: !!valveFromDb?.heating,
      setpoint,
      lastSeen: Date.now(),
      status: "ONLINE" as ValveStatus,
      roomId: valveFromDb?.room_id || undefined,
      manualSetpoint: true
    };
    upsertValve(valveId, setpoint, valves[valveId].heating, valves[valveId].temperature, valves[valveId].roomId, setpoint);
  }

  console.log(`✅ ${valveId}: manual setpoint ${setpoint}°C (DB + in-memory)`);
  return true;
}

export function clearManualSetpoint(valveId: string): boolean {
  if (!valves[valveId]) return false;
  valves[valveId].manualSetpoint = false;
  console.log(`🔄 ${valveId}: cleared manual setpoint flag`);
  return true;
}


export function removeValve(valveId: string) {
  if (overrides[valveId]) {
    clearTimeout(overrides[valveId].timeoutId);
    delete overrides[valveId];
  }

  if (valves[valveId]) {
    delete valves[valveId];
  }

  console.log(`🗑️ Valvola ${valveId} rimossa dal controller`);
}

// avvio “script mode”
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startController();
}
