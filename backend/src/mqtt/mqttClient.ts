import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER || "mqtt://localhost:1883";

const client = mqtt.connect(brokerUrl);

client.on("connect", () => {
  console.log("✅ Connected to MQTT broker:", brokerUrl);

  // Subscribe a un topic di test
  client.subscribe("test/topic", (err) => {
    if (!err) {
      console.log("📡 Subscribed to test/topic");
    }
  });

  // Pubblica un messaggio di test
  client.publish("test/topic", "Hello from Node.js 🚀");
});

client.on("message", (topic, message) => {
  console.log(`📩 Message received on ${topic}: ${message.toString()}`);
});

client.on("error", (err) => {
  console.error("❌ MQTT Error:", err);
});

export default client;