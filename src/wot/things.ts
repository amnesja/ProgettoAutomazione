import { Servient } from '@node-wot/core';
import { HttpServer } from '@node-wot/binding-http';
import { MqttBrokerServer } from '@node-wot/binding-mqtt';
import dotenv from 'dotenv';
import { updateSetpoint, getValveById } from "../db/repository.js";
import { valveThingModel } from "./valveTemplate.tm.js";
import { directoryThingModel } from "./directoryTemplate.tm.js";

dotenv.config();

const WOT_PORT = Number(process.env.WOT_PORT || 8081);
const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';

const httpServer = new HttpServer({ port: WOT_PORT });
const mqttServer = new MqttBrokerServer({ uri: brokerUrl });

const servient = new Servient();
servient.addServer(httpServer);
servient.addServer(mqttServer);

// Stato interno in memoria delle valvole per gestire i Read Handler del WoT
const valveStates: Record<string, { temperature: number; heating: boolean; setpoint: number }> = {};
const things: Record<string, any> = {};
let wot: any;
const VALID_VALVE_ID = /^valve\d+$/i;

const DEFAULT_SETPOINT = 20;

// CREAZIONE COSA GENERICA (VALVOLA)
async function createThing(valveId: string, initialSetpoint: number) {
  const thingTitle = `valve-${valveId}`;

  // Inizializziamo lo stato in memoria con il setpoint estratto dal DB
  valveStates[valveId] = {
    temperature: 20.0, 
    heating: false,
    setpoint: initialSetpoint
  };

  //Recuperiamo la Thing Description pulita e annotata semanticamente dal file esterno
  const tdConfig = valveThingModel(valveId);

  //Produciamo la Thing passando la TD generata dal template esterno
  const thing = await wot.produce(tdConfig);

  // Handler Lettura Proprietà (Interfaccia WoT standard)
  thing.setPropertyReadHandler('temperature', () => Promise.resolve(valveStates[valveId]?.temperature));
  thing.setPropertyReadHandler('heating', () => Promise.resolve(valveStates[valveId]?.heating));
  thing.setPropertyReadHandler('setpoint', () => Promise.resolve(valveStates[valveId]?.setpoint));

  // Handler Azione Telemetria (dal Simulatore)
  thing.setActionHandler('updateStatus', async (input: any) => {
    const data = await input.value();
    if (valveStates[valveId]) {
      const newTemp = parseFloat(data.temperature);
      const newHeating = Boolean(data.heating);

      // Emette il cambiamento solo se la temperatura è realmente mutati
      if (valveStates[valveId].temperature !== newTemp) {
        valveStates[valveId].temperature = newTemp;
        thing.emitPropertyChange('temperature');
      }

      valveStates[valveId].heating = newHeating;
      thing.emitPropertyChange('heating');
    }
    return Promise.resolve();
  });

  // Handler Azione setHeating (Comandi dal Controller)
  thing.setActionHandler('setHeating', async (input: any) => {
    const value = await input.value();
    const isHeating = Boolean(value);
    
    if (valveStates[valveId]) {
      // MODIFICA: Logga ed emette l'evento SOLO se lo stato dell'heating sta cambiando
      if (valveStates[valveId].heating !== isHeating) {
        valveStates[valveId].heating = isHeating;
        thing.emitPropertyChange('heating'); 
        console.log(`[WoT Server] setHeating per ${valveId} impostato a: ${isHeating}`);
      }
    }
    return Promise.resolve();
  });

  // Handler Azione setTargetTemperature (Comandi dal Controller o API)
  thing.setActionHandler('setTargetTemperature', async (input: any) => {
    const value = await input.value();
    const newSetpoint = parseFloat(value);
    
    if (!isNaN(newSetpoint) && valveStates[valveId]) {
      // Salva nel DB, logga ed emette l'evento SOLO se cambia il setpoint
      if (valveStates[valveId].setpoint !== newSetpoint) {
        valveStates[valveId].setpoint = newSetpoint;
        
        // Aggiorna il setpoint nel Database SQLite tramite repository
        updateSetpoint(valveId, newSetpoint);
        
        thing.emitPropertyChange('setpoint');
        console.log(`🎯 [WoT Server] setTargetTemperature memorizzato nel DB per ${valveId}: ${newSetpoint}°C`);
      }
    }
    return Promise.resolve();
  });

  thing.setActionHandler('delete', async () => {
    removeThing(valveId);
  });

  await thing.expose();
  things[valveId] = thing;

  // Forza la prima notifica MQTT del setpoint caricato dal database
  thing.emitPropertyChange('setpoint');

  console.log(`✅ WoT Thing esposta per ${valveId} via HTTP/MQTT`);
}

export function removeThing(valveId: string) {
  const thing = things[valveId];
  if (thing) {
    try { thing.destroy(); } catch (err) { console.warn(`⚠️ Errore destroy:`, err); }
    delete things[valveId];
    delete valveStates[valveId];
  }
  console.log(`🗑️ Thing WoT rimosso: valve-${valveId}`);
}


// CREAZIONE VALVE DIRECTORY
async function createDirectoryThing() {

  // Produciamo la Directory usando direttamente l'oggetto importato dal file esterno
  const directory = await wot.produce(directoryThingModel);

  directory.setPropertyReadHandler("valves", () => Promise.resolve(Object.keys(things)));

  directory.setActionHandler("register", async (input: any) => {
    try {
      const data = await input.value();
      const { id } = data;

      // 1. Validazione formale dell'ID della valvola
      if (!id || !VALID_VALVE_ID.test(id)) {
        throw new Error("ID Valvola non valido");
      }

      // Impostiamo il setpoint di fabbrica (20°C) come base di partenza
      let currentSetpoint = DEFAULT_SETPOINT;
      
      try {
        // Chiamiamo il repository per vedere se la valvola esiste già
        const valveFromDb = getValveById(id) as any;
        
        if (valveFromDb) {
          // Caso A: La valvola esiste nel DB, carichiamo il suo setpoint personalizzato
          currentSetpoint = valveFromDb.setpoint;
          console.log(`💾 [Repository] Trovata valvola ${id}. Setpoint caricato: ${currentSetpoint}°C`);
        } else {
          // Caso B: La valvola è nuova nel DB e lasciamo il setpoint di default (20°C) e lo logghiamo.
          console.log(`💾 [Repository] Nuova valvola ${id} rilevata. Assegnato setpoint di default: ${currentSetpoint}°C`);
        }
      } catch (dbErr) {
        console.error("⚠️ Errore durante la lettura dal database, uso il valore di default:", dbErr);
      }

      // 2. Gestione del Gemello Digitale (RAM del Server WoT)
      if (!things[id]) {
        console.log(`✨ [Directory] Nuova valvola hardware rilevata: ${id}. Generazione Thing...`);
        await createThing(id, currentSetpoint);
        directory.emitPropertyChange('valves');
      } else {
        console.log(`🔄 [Directory] Valvola ${id} già istanziata. Invio configurazione corrente.`);
        const existingThing = things[id];
        if (existingThing) {
          existingThing.emitPropertyChange('setpoint');
          existingThing.emitPropertyChange('heating');
        }
      }

      // 3. Risposta formale all'hardware (Output dell'Action)
      return Promise.resolve({ setpoint: valveStates[id].setpoint });
    } catch (err: any) {
      console.error("❌ Errore durante la registrazione:", err.message);
      return Promise.reject(err);
    }
  });

  await directory.expose();
  console.log("📘 Valve Directory esposta via HTTP/MQTT");
}

// Avvio del Servient WoT
servient.start().then(async (wo) => {
  wot = wo;
  console.log('🚀 WoT Servient avviato con successo.');
  await createDirectoryThing();
}).catch(console.error);