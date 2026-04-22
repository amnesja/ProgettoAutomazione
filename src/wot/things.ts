import { Servient } from '@node-wot/core';
import { HttpServer } from '@node-wot/binding-http';
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const mqttClient = mqtt.connect(brokerUrl);

const servient = new Servient();
servient.addServer(new HttpServer({ port: 8081 })); // porta per WoT

// stato valvole
const valveStates: Record<string, { temperature: number; heating: boolean }> = {};
const things: Record<string, any> = {}; // WoT Things
let wot: any; // WoT instance

async function createThing(valveId: string) {
  const thing = await wot.produce({
    title: `Valve ${valveId}`,
    description: `Smart thermostat valve ${valveId}`,
    properties: {
      temperature: {
        type: 'number',
        description: 'Current temperature in Celsius',
        readOnly: true,
        observable: true
      },
      heating: {
        type: 'boolean',
        description: 'Heating status',
        readOnly: true,
        observable: true
      }
    },
    actions: {
      setHeating: {
        description: 'Set heating on or off',
        input: { type: 'boolean' }
      }
    }
  });

  // read handlers
  thing.setPropertyReadHandler('temperature', () => {
    return Promise.resolve(valveStates[valveId]?.temperature || 20);
  });

  thing.setPropertyReadHandler('heating', () => {
    return Promise.resolve(valveStates[valveId]?.heating || false);
  });

  // action handler
  thing.setActionHandler('setHeating', (input: any) => {
    const heating = input;
    const payload = JSON.stringify({ heating });
    mqttClient.publish(`home/valves/${valveId}/command`, payload);
    console.log(`🔥 WoT: Set ${valveId} heating to ${heating}`);
    return Promise.resolve();
  });

  await thing.expose();
  things[valveId] = thing;
  console.log(`✅ WoT Thing exposed for ${valveId} at http://localhost:8081/${valveId}`);
}

mqttClient.on('connect', () => {
  console.log('✅ WoT MQTT connected');
  // subscribe will be done after wot is ready
});

mqttClient.on('message', async (topic, message) => {
  const match = topic.match(/home\/valves\/(.+)\/temperature/);
  if (!match) return;

  const valveId = match[1];
  const data = JSON.parse(message.toString());
  const { temperature, heating } = data;

  valveStates[valveId] = { temperature: parseFloat(temperature), heating };

  // se non esiste Thing, crealo
  if (!things[valveId]) {
    await createThing(valveId);
  } else {
    // notifica cambiamento proprietà (se supportato)
    // per ora, solo aggiorna stato
  }

  console.log(`🌡️ WoT updated ${valveId}: temp=${temperature}, heating=${heating}`);
});

servient.start().then((wo) => {
  wot = wo;
  console.log('✅ WoT Servient started on http://localhost:8081');
  // now subscribe
  mqttClient.subscribe('home/valves/+/temperature');
}).catch(console.error);