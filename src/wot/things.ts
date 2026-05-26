import { Servient } from '@node-wot/core';
import { HttpServer } from '@node-wot/binding-http';
import { MqttBrokerServer } from '@node-wot/binding-mqtt';
import dotenv from 'dotenv';

// ✅ Importazioni reali dal tuo Database e Repository
import db from "../db/database.js";
import { updateSetpoint, getRoomById } from "../db/repository.js";

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

// ==========================================
// CREAZIONE COSA GENERICA (VALVOLA)
// ==========================================
async function createThing(valveId: string, initialSetpoint: number) {
  const thingTitle = `valve-${valveId}`;

  // Inizializziamo lo stato in memoria con il setpoint estratto dal DB
  valveStates[valveId] = {
    temperature: 20.0, // Verrà aggiornato immediatamente dal simulatore via updateStatus
    heating: false,
    setpoint: initialSetpoint
  };

  const thing = await wot.produce({
    title: thingTitle,
    description: `Smart thermostat valve ${valveId}`,
    properties: {
      temperature: { type: 'number', readOnly: true, observable: true },
      heating: { type: 'boolean', readOnly: true, observable: true },
      setpoint: { type: 'number', readOnly: true, observable: true } 
    },
    actions: {
      // Azione continua invocata dal simulatore (telemetria)
      updateStatus: {
        input: {
          type: 'object',
          properties: {
            temperature: { type: 'number' },
            heating: { type: 'boolean' }
          },
          required: ['temperature', 'heating']
        }
      },
      // Azione usata dal Controller esterno per cambiare l'heating
      setHeating: { input: { type: 'boolean' } },
      
      // Azione per cambiare manualmente il setpoint da Controller
      setTargetTemperature: { input: { type: 'number' } },
      
      delete: {}
    }
  });

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

      // Emette il cambiamento solo se i valori sono realmente mutati
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
      // ✅ MODIFICA: Logga ed emette l'evento SOLO se lo stato dell'heating sta cambiando
      if (valveStates[valveId].heating !== isHeating) {
        valveStates[valveId].heating = isHeating;
        thing.emitPropertyChange('heating'); 
        console.log(`🔥 [WoT Server] setHeating per ${valveId} impostato a: ${isHeating}`);
      }
    }
    return Promise.resolve();
  });

  // Handler Azione setTargetTemperature (Comandi dal Controller o API)
  thing.setActionHandler('setTargetTemperature', async (input: any) => {
    const value = await input.value();
    const newSetpoint = parseFloat(value);
    
    if (!isNaN(newSetpoint) && valveStates[valveId]) {
      // ✅ MODIFICA: Salva nel DB, logga ed emette l'evento SOLO se cambia il setpoint
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

// ==========================================
// 📘 CREAZIONE VALVE DIRECTORY
// ==========================================
async function createDirectoryThing() {
  const directory = await wot.produce({
    title: "ValveDirectory",
    description: "List and registration gateway for all available valves",
    properties: {
      valves: { type: "array", readOnly: true }
    },
    actions: {
      register: {
        input: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        output: {
          type: "object",
          properties: { setpoint: { type: "number" } }
        }
      }
    }
  });

  directory.setPropertyReadHandler("valves", () => Promise.resolve(Object.keys(things)));

  directory.setActionHandler("register", async (input: any) => {
    try {
      const data = await input.value();
      const { id } = data;

      if (!id || !VALID_VALVE_ID.test(id)) {
        throw new Error("ID Valvola non valido");
      }

      let currentSetpoint = DEFAULT_SETPOINT;
      
      try {
        const valveFromDb = db.prepare("SELECT setpoint, room_id FROM valves WHERE id = ?").get(id) as any;
        
        if (valveFromDb) {
          currentSetpoint = valveFromDb.setpoint;
          console.log(`💾 [DB] Trovata valvola ${id}. Setpoint caricato: ${currentSetpoint}°C`);
        } else {
          console.log(`💾 [DB] Valvola ${id} non presente nel DB. Controllo ereditarietà stanza...`);
          
          // Se la valvola non esiste ancora, proviamo a vedere se esiste una stanza di default con lo stesso nome o ID
          const fallbackRoom = getRoomById(id); 
          if (fallbackRoom) {
            currentSetpoint = (fallbackRoom as any).global_setpoint;
            console.log(`💾 [DB] Stanza di fallback trovata per ${id}. Setpoint globale ereditato: ${currentSetpoint}°C`);
          }
        }
      } catch (dbErr) {
        console.error("⚠️ Errore durante la lettura dal database SQLite, uso il valore di default:", dbErr);
      }

      if (!things[id]) {
        console.log(`✨ [Directory] Nuova valvola hardware rilevata: ${id}. Generazione Thing...`);
        await createThing(id, currentSetpoint);
        directory.emitPropertyChange('valves');
      } else {
        console.log(`🔄 [Directory] Valvola ${id} già istanziata. Invio configurazione corrente.`);
        // 🔥 SOLUZIONE: Forza il server WoT a ri-pubblicare lo stato attuale sui topic delle proprietà.
        // In questo modo il simulatore appena riconnesso riceverà subito i valori corretti tramite i suoi subscribe!
        const existingThing = things[id];
        if (existingThing) {
          existingThing.emitPropertyChange('setpoint');
          existingThing.emitPropertyChange('heating');
        }
      }

      // Rispondiamo al simulatore passandogli il setpoint ufficiale
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