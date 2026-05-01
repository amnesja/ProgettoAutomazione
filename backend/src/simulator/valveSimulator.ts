import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";

// prendi ID da argomento (es: valve1)
const valveId = process.argv[2] || "valve1";

const client = mqtt.connect(brokerUrl);

let temperature = 20; // temperatura iniziale
let heating = false;

client.on("connect", () => {
  console.log(`✅ Simulator connected (${valveId})`);

  // ascolta comandi
  client.subscribe(`home/valves/${valveId}/command`);

  // invia temperatura ogni 5 secondi
  setInterval(() => {
    // Simulazione con limite minimo (temperatura ambiente invernale = 5°C)
    const MIN_TEMP = 5;
    const MAX_TEMP = 30;

    if (heating) {
      temperature += 0.3;
      if (temperature > MAX_TEMP) temperature = MAX_TEMP;
    } else {
      temperature -= 0.1;
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

    console.log(`🌡️ [${valveId}] ${payload}`);
  }, 5000);
});

// ricezione comandi
client.on("message", (topic, message) => {
  const data = JSON.parse(message.toString());

if (topic === `home/valves/${valveId}/command`) {
    heating = data.heating;
    console.log(`🔥 [${valveId}] Heating set to: ${heating}`);
  }
});
