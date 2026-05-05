import { Servient } from '@node-wot/core';
import { HttpServer } from '@node-wot/binding-http';
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();


// Configurazione MQTT 
const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const mqttClient = mqtt.connect(brokerUrl);


//  Creazione del Servient Wot + HTTP Server 
const httpServer = new HttpServer({ port: 8081 });

const servient = new Servient();
servient.addServer(httpServer);


// Stato interno delle valvole 
const valveStates: Record<string, { temperature: number; heating: boolean }> = {};
const things: Record<string, any> = {};
let wot: any;
const VALID_VALVE_ID = /^valve\d+$/i;


//  Crea un Thing Wot per una valvola
async function createThing(valveId: string) {
  const thingTitle = `valve-${valveId}`;

  const thing = await wot.produce({
    title: thingTitle,
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
      },
      delete: {} 
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

  thing.setActionHandler('delete', async () => {
  removeThing(valveId);
  });


  await thing.expose();
  things[valveId] = thing;

  console.log(`✅ WoT Thing exposed for ${valveId} at http://localhost:8081/${thingTitle}`);
}

// cancella un thing Wot per una valvola 
export function removeThing(valveId: string) {
  const thing = things[valveId];
  const thingName = `valve-${valveId}`;

  if (thing) {
    try {
      thing.destroy();
    } catch (err) {
      console.warn(`⚠️ Errore durante destroy() di ${thingName}:`, err);
    }

    delete things[valveId];
  }

  console.log(`🗑️ Thing WoT rimosso: ${thingName}`);
}

//  Directory Thing - Lista delle Valvole 

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

// MQTT: Connessione 
mqttClient.on('connect', () => {
  console.log('✅ WoT MQTT connected');
});

// MQTT: Ricezione Dati 
mqttClient.on('message', async (topic, message) => {

  const match = topic.match(/home\/valves\/(.+)\/temperature/);
  if (!match) return;

  const valveId = match[1];
  if (!VALID_VALVE_ID.test(valveId)) {
    console.warn(`Ignoring invalid valve id for WoT: ${valveId}`);
    return;
  }
  const data = JSON.parse(message.toString());
  const { temperature, heating } = data;

  valveStates[valveId] = { temperature: parseFloat(temperature), heating };

  if (!things[valveId]) {
    await createThing(valveId);
  }

  console.log(`🌡️ WoT updated ${valveId}: temp=${temperature}, heating=${heating}`);
});

// Avvio del Servient Wot
servient.start().then(async (wo) => {
  wot = wo;

  console.log('🚀 HttpServer listening on http://localhost:8081');
  console.log('✅ WoT Servient started');

  await createDirectoryThing();
  mqttClient.subscribe('home/valves/+/temperature');

}).catch(console.error);


