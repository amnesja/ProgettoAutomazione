import express from "express";
import dotenv from "dotenv";
import { getValves, getTemperatureHistory, updateSetpoint } from "../db/repository.js";
import { setOverride, getActiveOverrides, cancelOverride } from "../controller/controller.js";

dotenv.config();

const app = express();
app.use(express.json());

// GET /valves → lista valvole
app.get("/valves", (req, res) => {
  const valves = getValves();
  res.json(valves);
});

// GET /valves/:id/history → storico temperature
app.get("/valves/:id/history", (req, res) => {
  const valveId = req.params.id;
  const history = getTemperatureHistory(valveId);
  res.json(history);
});

// POST /setpoint → aggiorna setpoint nel DB
app.post("/setpoint", (req, res) => {
  const { valveId, setpoint } = req.body;

  if (!valveId || typeof setpoint !== "number") {
    return res.status(400).json({ error: "valveId and numeric setpoint are required" });
  }

  updateSetpoint(valveId, setpoint);

  res.json({ message: "Setpoint updated", valveId, setpoint });
});

// POST /override → attiva un override manuale
app.post("/override", (req, res) => {
  const { valveId, state, duration } = req.body;

  if (!valveId || typeof state !== "boolean" || typeof duration !== "number") {
    return res.status(400).json({
      error: "valveId (string), state (boolean), and duration (number in seconds) are required"
    });
  }

  if (duration <= 0) {
    return res.status(400).json({ error: "duration must be greater than 0" });
  }

  const success = setOverride(valveId, state, duration);

  if (!success) {
    return res.status(404).json({ error: `Valve ${valveId} not found` });
  }

  res.json({
    message: "Override activated",
    valveId,
    state: state ? "ON" : "OFF",
    duration,
    expiresAt: new Date(Date.now() + duration * 1000).toISOString()
  });
});

// GET /overrides → visualizza override attivi
app.get("/overrides", (req, res) => {
  const active = getActiveOverrides();
  res.json({ active, count: Object.keys(active).length });
});

// DELETE /override/:valveId → cancella un override
app.delete("/override/:valveId", (req, res) => {
  const { valveId } = req.params;
  const success = cancelOverride(valveId);

  if (!success) {
    return res.status(404).json({ error: `No active override for ${valveId}` });
  }

  res.json({ message: "Override cancelled", valveId });
});

const PORT = process.env.PORT || 3001;

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../../public")));

app.listen(PORT, () => {
  console.log(`✅ HTTP API running on port ${PORT}`);
});
