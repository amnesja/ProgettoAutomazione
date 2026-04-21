import express from "express";
import dotenv from "dotenv";
import { getValves, getTemperatureHistory, updateSetpoint } from "../db/repository.js";

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

// POST /override → per ora solo stub, lo completeremo dopo
app.post("/override", (req, res) => {
  res.status(501).json({ message: "Override not implemented yet" });
});

const PORT = process.env.PORT || 3000;

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../../public")));

app.listen(PORT, () => {
  console.log(`✅ HTTP API running on port ${PORT}`);
});
