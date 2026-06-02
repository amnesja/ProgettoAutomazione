import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";

// Prendi l'ID della valvola dagli argomenti del terminale (es: npm run simulator valve1)
const valveId = process.argv[2] || "valve1";

const client = mqtt.connect(brokerUrl);

// Stato interno del Simulatore Hardware
let temperature = 20.0; 
let heating = false;
let setpoint = 20.0; 

client.on("connect", () => {
  console.log(`✅ Simulator Hardware connected (${valveId})`);
  
  // FASE 1: REGISTRAZIONE ALLA VALVE DIRECTORY
  const registrationTopic = "ValveDirectory/actions/register";
  const registrationPayload = JSON.stringify({ id: valveId });

  console.log(`[${valveId}] Invio richiesta di registrazione alla Directory...`);
  client.publish(registrationTopic, registrationPayload);

  client.subscribe(`ValveDirectory/actions/register/responses`);

  // FASE 2: ISCRIZIONE AI CAMBIAMENTI DEL CONTROLLER
  client.subscribe(`valve-${valveId}/properties/heating`);
  client.subscribe(`valve-${valveId}/properties/setpoint`);

  // FASE 3: CICLO CONTINUO DI TELEMETRIA (Ogni 5 secondi)
  setInterval(() => {
    // Logica di simulazione fisica della temperatura
    if (heating) {
      temperature += 0.2;
    } else {
      temperature -= 0.1;
    }

    const updateTopic = `valve-${valveId}/actions/updateStatus`;
    const payload = JSON.stringify({
      temperature: parseFloat(temperature.toFixed(2)),
      heating: heating
    });

    client.publish(updateTopic, payload);
    console.log(`🌡️ [${valveId} Telemetria Inviata] Temp: ${temperature.toFixed(2)}°C | Heating: ${heating} | Setpoint Corrente: ${setpoint}°C`);
  }, 5000);
});

// RICEZIONE MESSAGGI (Risposte e Comandi dal WoT)
client.on("message", (topic, message) => {
  try {
    const rawPayload = message.toString();

    // Caso A: Ricezione del Setpoint iniziale dalla Directory
    if (topic === `ValveDirectory/actions/register/responses`) {
      const data = JSON.parse(rawPayload);
      if (data && typeof data.setpoint === "number") {
        setpoint = data.setpoint;
        console.log(`💾 [${valveId}] Setpoint iniziale sincronizzato da DB: ${setpoint}°C`);
        client.unsubscribe(`ValveDirectory/actions/register/responses`);
      }
      return;
    }

    // Caso B: Il Controller ha cambiato lo stato del riscaldamento
    if (topic === `valve-${valveId}/properties/heating`) {
      const targetHeating = rawPayload === "true";
      // ✅ MODIFICA: Logga e applica SOLO se lo stato cambia veramente
      if (heating !== targetHeating) {
        heating = targetHeating;
        console.log(`🔥 [${valveId} Hardware Comando] Heating impostato a: ${heating}`);
      }
      return;
    }

    // Caso C: Il Controller ha cambiato manualmente il setpoint
    if (topic === `valve-${valveId}/properties/setpoint`) {
      const targetSetpoint = parseFloat(rawPayload);
      // MODIFICA: Logga e applica SOLO se il setpoint cambia veramente
      if (setpoint !== targetSetpoint) {
        setpoint = targetSetpoint;
        console.log(`🎯 [${valveId} Hardware Comando] Setpoint locale aggiornato a: ${setpoint}°C`);
      }
      return;
    }

  } catch (err) {
    console.error(`❌ Errore nel processing del messaggio MQTT sul topic ${topic}:`, err);
  }
});