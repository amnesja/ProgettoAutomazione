import mqtt from "mqtt";
import dotenv from "dotenv";
import { upsertValve, insertTemperature, updateValveStatus, getRoomById, assignValveToRoom as persistValveRoomAssignment, setValveManualSetpoint, getValveManualSetpoint } from "../db/repository.js";
import db from "../db/database.js";
import { fileURLToPath } from "url";
dotenv.config();
const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const VALID_VALVE_ID = /^valve\d+$/i;
// stato valvole (in-memory)
const valves = {};
const overrides = {};
// MQTT client inizializzato solo quando avvii il controller
let mqttClient = null;
let offlineIntervalId = null;
const DEFAULT_SETPOINT = 20;
const HYSTERESIS = 1;
const OFFLINE_TIMEOUT = 30000; // 30 secondi senza dati = OFFLINE
function publishHeatingCommand(valveId, heating) {
    if (!mqttClient)
        return;
    const payload = JSON.stringify({ heating });
    mqttClient.publish(`home/valves/${valveId}/command`, payload);
}
function setupOfflineWatcher() {
    if (offlineIntervalId)
        return;
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
    if (mqttClient)
        return mqttClient; // già avviato
    mqttClient = mqtt.connect(brokerUrl);
    mqttClient.on("connect", () => {
        console.log("✅ Controller connected to MQTT");
        mqttClient?.subscribe("home/valves/+/temperature");
    });
    mqttClient.on("message", (topic, message) => {
        const data = JSON.parse(message.toString());
        const match = topic.match(/home\/valves\/(.+)\/temperature/);
        if (!match)
            return;
        const valveId = match[1];
        if (!valveId)
            return;
        if (!VALID_VALVE_ID.test(valveId)) {
            console.warn(`Ignoring invalid valve id: ${valveId}`);
            return;
        }
        const temperature = parseFloat(data.temperature);
        if (!valves[valveId]) {
            const valveFromDb = db.prepare("SELECT room_id FROM valves WHERE id = ?").get(valveId);
            const roomId = valveFromDb?.room_id;
            let setpoint = DEFAULT_SETPOINT;
            if (roomId) {
                const room = getRoomById(roomId);
                if (room)
                    setpoint = room.global_setpoint ?? DEFAULT_SETPOINT;
            }
            valves[valveId] = {
                temperature,
                heating: false,
                setpoint,
                lastSeen: Date.now(),
                status: "ONLINE",
                roomId
            };
            upsertValve(valveId, setpoint, false, temperature, roomId);
        }
        else {
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
          const valveFromDb = db.prepare("SELECT room_id FROM valves WHERE id = ?").get(valveId);
          valves[valveId].roomId = valveFromDb?.room_id || undefined;
        }

        const roomId = valves[valveId].roomId;
        const manualFromDb = getValveManualSetpoint(valveId);
        if (manualFromDb !== null) {
          // Use manual setpoint from DB
          if (Math.abs(valves[valveId].setpoint - manualFromDb) > 0.01) {
            console.log(`📋 ${valveId}: using manual setpoint ${manualFromDb}°C from DB`);
            valves[valveId].setpoint = manualFromDb;
            valves[valveId].manualSetpoint = true;
          }
        } else if (roomId) {
          // No manual, sync from room
          const room = getRoomById(roomId);
          const roomSetpoint = room?.global_setpoint ?? DEFAULT_SETPOINT;
          if (Math.abs(valves[valveId].setpoint - roomSetpoint) > 0.01) {
            console.log(`🔄 ${valveId}: sync setpoint to room "${roomId}" → ${roomSetpoint}°C (was ${valves[valveId].setpoint}°C)`);
            valves[valveId].setpoint = roomSetpoint;
            valves[valveId].manualSetpoint = false;
            upsertValve(valveId, roomSetpoint, valves[valveId].heating, valves[valveId].temperature, roomId, null);
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
                console.log(`⚠️ OVERRIDE ${valveId}: heating = ${overrideState} (scade in ${Math.floor((overrides[valveId].endTime - now) / 1000)}s)`);
            }
            else {
                console.log(`⚠️ OVERRIDE ${valveId}: heating = ${overrideState} (scade in ${Math.floor((overrides[valveId].endTime - now) / 1000)}s)`);
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
        }
        else if (temperature > setpoint + HYSTERESIS) {
            newState = false;
        }
        if (newState !== currentState) {
            valves[valveId].heating = newState;
            upsertValve(valveId, setpoint, newState, temperature);
            publishHeatingCommand(valveId, newState);
            console.log(`🔥 ${valveId}: heating = ${newState}`);
        }
        else {
            console.log(`⏸️ ${valveId}: no change (${temperature}°C)`);
        }
    });
    setupOfflineWatcher();
    return mqttClient;
}
// Funzioni esportate per gestire gli override
export function setOverride(valveId, state, durationSeconds) {
    if (!valves[valveId])
        return false;
    if (overrides[valveId])
        clearTimeout(overrides[valveId].timeoutId);
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
    const active = {};
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
export function cancelOverride(valveId) {
    if (!overrides[valveId])
        return false;
    clearTimeout(overrides[valveId].timeoutId);
    delete overrides[valveId];
    console.log(`❌ Override cancellato per ${valveId}`);
    return true;
}
export function assignValveRoom(valveId, roomId) {
    if (!VALID_VALVE_ID.test(valveId))
        return null;
    const assignment = persistValveRoomAssignment(valveId, roomId || "");
    if (!assignment)
        return null;
    const valve = valves[valveId];
    if (valve) {
        valve.roomId = assignment.roomId || undefined;
        valve.setpoint = assignment.setpoint;
        upsertValve(valveId, assignment.setpoint, valve.heating, valve.temperature, assignment.roomId || undefined);
    }
    return assignment;
}
// funzione di rimozione della valvola
export function removeValve(valveId) {
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
