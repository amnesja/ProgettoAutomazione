// -------------------------------------------------------------
//  IMPORT DELLE LIBRERIE
// -------------------------------------------------------------
import { Servient } from '@node-wot/core';
import { HttpServer } from '@node-wot/binding-http';
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------
//  CONFIGURAZIONE MQTT
// -------------------------------------------------------------
const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const mqttClient = mqtt.connect(brokerUrl);

// -------------------------------------------------------------
//  CREAZIONE DEL SERVIENT WoT + HTTP SERVER
// -------------------------------------------------------------
const httpServer = new HttpServer({ port: 8081 });

const servient = new Servient();
servient.addServer(httpServer);

// -------------------------------------------------------------
//  STATO INTERNO DELLE VALVOLE
// -------------------------------------------------------------
const valveStates: Record<string, { temperature: number; heating: boolean }> = {};
const things: Record<string, any> = {};
let wot: any;

// -------------------------------------------------------------
//  CREA UN THING WoT PER UNA VALVOLA
// -------------------------------------------------------------
async function createThing(valveId: string) {

  const thing = await wot.produce({
    title: `valve ${valveId}`,
    description: `Smart thermostat valve ${valveId}`,

    properties: {
      temperature: {
        type: 'number',
        readOnly: true,
        observable: true
      },
      heating: {
        type: 'boolean',
        readOnly: true,
        observable: true
      }
    },

    actions: {
      setHeating: {
        input: { type: 'boolean' }
      }
    }
  });

  thing.setPropertyReadHandler('temperature', () => {
    return Promise.resolve(valveStates[valveId]?.temperature ?? 20);
  });

  thing.setPropertyReadHandler('heating', () => {
    return Promise.resolve(valveStates[valveId]?.heating ?? false);
  });

  thing.setActionHandler('setHeating', (input: any) => {
    mqttClient.publish(
      `home/valves/${valveId}/command`,
      JSON.stringify({ heating: input })
    );
    return Promise.resolve();
  });

  await thing.expose();
  things[valveId] = thing;

  console.log(`✅ WoT Thing exposed for ${valveId} at http://localhost:8081/${valveId}`);
}

// -------------------------------------------------------------
//  DIRECTORY THING — LISTA DELLE VALVOLE
// -------------------------------------------------------------
async function createDirectoryThing() {
  const directory = await wot.produce({
    title: "ValveDirectory",
    description: "List of all available valves",

    properties: {
      valves: {
        type: "array",
        readOnly: true
      }
    }
  });

  directory.setPropertyReadHandler("valves", () => {
    return Promise.resolve(Object.keys(things));
  });

  await directory.expose();

  console.log("📘 Valve Directory exposed at http://localhost:8081/ValveDirectory");
}

// -------------------------------------------------------------
//  MQTT: CONNESSIONE
// -------------------------------------------------------------
mqttClient.on('connect', () => {
  console.log('✅ WoT MQTT connected');
});

// -------------------------------------------------------------
//  MQTT: RICEZIONE DATI
// -------------------------------------------------------------
mqttClient.on('message', async (topic, message) => {

  const match = topic.match(/home\/valves\/(.+)\/temperature/);
  if (!match) return;

  const valveId = match[1];
  const data = JSON.parse(message.toString());
  const { temperature, heating } = data;

  valveStates[valveId] = { temperature: parseFloat(temperature), heating };

  if (!things[valveId]) {
    await createThing(valveId);
  }

  console.log(`🌡️ WoT updated ${valveId}: temp=${temperature}, heating=${heating}`);
});

// -------------------------------------------------------------
//  AVVIO DEL SERVIENT WoT
// -------------------------------------------------------------
servient.start().then(async (wo) => {
  wot = wo;

  console.log('🚀 HttpServer listening on http://localhost:8081');
  console.log('✅ WoT Servient started');

  await createDirectoryThing();
  mqttClient.subscribe('home/valves/+/temperature');

}).catch(console.error);
