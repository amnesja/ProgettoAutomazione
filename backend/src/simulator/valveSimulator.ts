import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";

// prendi ID da argomento (es: valve1)
const valveId = process.argv[2] || "valve1";

const client = mqtt.connect(brokerUrl);

let temperature = 20; // temperatura iniziale
let heating = false;

const MIN_TEMP = 5;
const MAX_TEMP = 28; // più realistico per interni

client.on("connect", () => {
  console.log(`✅ Simulator connected (${valveId})`);

  // ascolta comandi
  client.subscribe(`home/valves/${valveId}/command`);

  // invia temperatura ogni 3-7 secondi (variazione naturale)
  const interval = 3000 + Math.random() * 4000;
  setInterval(() => {
    if (heating) {
      // Riscaldamento: +0.2-0.4°C
      temperature += 0.2 + Math.random() * 0.2;
      if (temperature > MAX_TEMP) temperature = MAX_TEMP;
    } else {
      // Raffreddamento naturale: -0.2-0.5°C (più aggressivo)
      temperature -= 0.2 + Math.random() * 0.3;
      if (temperature < MIN_TEMP) temperature = MIN_TEMP;
    }

    const payload = JSON.stringify({
      temperature: temperature.toFixed(2),
      heating: heating
    });

    client.publish(
      `home/valves/${valveId}/temperature`,
      payload
    );

    console.log(`🌡️ [${valveId}] temp=${temperature.toFixed(1)}°C heating=${heating}`);
  }, interval);
});

// ricezione comandi
client.on("message", (topic, message) => {
  const data = JSON.parse(message.toString());

  if (topic === `home/valves/${valveId}/command`) {
    heating = data.heating;
    console.log(`🔥 [${valveId}] Heating set to: ${heating}`);
  }
});

