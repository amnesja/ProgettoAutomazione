import dotenv from "dotenv";

dotenv.config();

export const env = {
  MQTT_BROKER: process.env.MQTT_BROKER ?? "mqtt://localhost:1883",
  PORT: Number(process.env.PORT ?? "3001"),
  WOT_PORT: Number(process.env.WOT_PORT ?? "8081"),
  SQLITE_DB_PATH: process.env.SQLITE_DB_PATH ?? "thermostat.db",
  // Separation frontend/backend
  SERVE_FRONTEND: process.env.SERVE_FRONTEND ? process.env.SERVE_FRONTEND === "true" : true,
  FRONTEND_DIR: process.env.FRONTEND_DIR ?? "public"
} as const;

export function assertEnv() {
  const errors: string[] = [];

  if (!env.MQTT_BROKER) errors.push("MQTT_BROKER is required");
  if (!Number.isFinite(env.PORT) || env.PORT <= 0) errors.push("PORT must be a positive number");
  if (!Number.isFinite(env.WOT_PORT) || env.WOT_PORT <= 0) errors.push("WOT_PORT must be a positive number");
  if (!env.SQLITE_DB_PATH) errors.push("SQLITE_DB_PATH is required");

  if (errors.length > 0) {
    throw new Error(`Invalid environment variables: ${errors.join(", ")}`);
  }
}
