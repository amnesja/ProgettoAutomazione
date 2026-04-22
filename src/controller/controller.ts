import mqtt from "mqtt";
import dotenv from "dotenv";
import { upsertValve, insertTemperature, updateValveStatus } from "../db/repository.js";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const client = mqtt.connect(brokerUrl);

// stato valvole
const valves: Record<string, { temperature: number; heating: boolean; setpoint: number; lastSeen: number; status: 'ONLINE' | 'OFFLINE' }> = {};

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

client.on("connect", () => {
  console.log("✅ Controller connected to MQTT");

  // ascolta tutte le valvole
  client.subscribe("home/valves/+/temperature");
});

client.on("message", (topic, message) => {
  const data = JSON.parse(message.toString());

  // estrai valveId dal topic
  const match = topic.match(/home\/valves\/(.+)\/temperature/);
  if (!match) return;

  const valveId = match[1]!;
  if (!valveId) return;
  const temperature = parseFloat(data.temperature);

  if (!valves[valveId]) {
    valves[valveId] = { temperature, heating: false, setpoint: DEFAULT_SETPOINT, lastSeen: Date.now(), status: 'ONLINE' };
  } else {
    // se era offline, torna online
    if (valves[valveId].status === 'OFFLINE') {
      valves[valveId].status = 'ONLINE';
      updateValveStatus(valveId, 'ONLINE');
      console.log(`✅ ${valveId}: BACK ONLINE`);
    }
  }

  valves[valveId].temperature = temperature;
  valves[valveId].lastSeen = Date.now();

  insertTemperature(valveId, temperature);

  console.log(`🌡️ ${valveId}: ${temperature}°C`);

  // CONTROLLA SE C'È UN OVERRIDE ATTIVO
  const now = Date.now();
  if (overrides[valveId] && overrides[valveId].endTime > now) {
    // override ancora valido
    const overrideState = overrides[valveId].state;
    const currentState = valves[valveId].heating;
    
    if (overrideState !== currentState) {
      valves[valveId].heating = overrideState;
      upsertValve(valveId, valves[valveId].setpoint, overrideState, temperature);
      const payload = JSON.stringify({ heating: overrideState });
      client.publish(`home/valves/${valveId}/command`, payload);
      console.log(`⚠️ OVERRIDE ${valveId}: heating = ${overrideState} (scade in ${Math.floor((overrides[valveId].endTime - now) / 1000)}s)`);
    } else {
      console.log(`⚠️ OVERRIDE ${valveId}: heating = ${overrideState} (scade in ${Math.floor((overrides[valveId].endTime - now) / 1000)}s)`);
    }
  } else {
    // override scaduto o non esiste, rimuovi se esiste
    if (overrides[valveId]) {
      clearTimeout(overrides[valveId].timeoutId);
      delete overrides[valveId];
      console.log(`🔄 ${valveId}: override scaduto, logica automatica ripresa`);
    }

    // LOGICA CON ISTERESI
    const setpoint = valves[valveId].setpoint;
    let currentState = valves[valveId].heating;
    let newState = currentState;

    if (temperature < setpoint - HYSTERESIS) {
      newState = true;
    } else if (temperature > setpoint + HYSTERESIS) {
      newState = false;
    }

    // aggiorna solo se cambia
    if (newState !== currentState) {
      valves[valveId].heating = newState;
      upsertValve(valveId, setpoint, newState, temperature);
      const payload = JSON.stringify({ heating: newState });

      client.publish(`home/valves/${valveId}/command`, payload);

      console.log(`🔥 ${valveId}: heating = ${newState}`);
    } else {
      console.log(`⏸️ ${valveId}: no change (${temperature}°C)`);
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