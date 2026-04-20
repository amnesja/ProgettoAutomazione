import mqtt from "mqtt";
import dotenv from "dotenv";
import { upsertValve, insertTemperature } from "../db/repository.js";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const client = mqtt.connect(brokerUrl);

// stato valvole
const valves: Record<string, { temperature: number; heating: boolean; setpoint: number }> = {};

// setpoint di default + ISTERESI
const DEFAULT_SETPOINT = 20;
const HYSTERESIS = 1;

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
    valves[valveId] = { temperature, heating: false, setpoint: DEFAULT_SETPOINT };
  }

  valves[valveId].temperature = temperature;

  insertTemperature(valveId, temperature);

  console.log(`🌡️ ${valveId}: ${temperature}°C`);

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
    upsertValve(valveId, setpoint, newState);
    const payload = JSON.stringify({ heating: newState });

    client.publish(`home/valves/${valveId}/command`, payload);

    console.log(`🔥 ${valveId}: heating = ${newState}`);
  } else {
    console.log(`⏸️ ${valveId}: no change (${temperature}°C)`);
  }
});