import express from "express";
import dotenv from "dotenv";
import { getValves, getTemperatureHistory, updateSetpoint, createRoom, getRooms, getRoomById, updateRoomSetpoint, getValvesByRoom, getRoomAnalytics, deleteValve, deleteRoom } from "../db/repository.js";
import { setOverride, getActiveOverrides, cancelOverride, assignValveRoom, removeValve, updateManualSetpoint } from "../controller/controller.js";


dotenv.config();

const app = express();
app.use(express.json());
const VALID_VALVE_ID = /^valve\d+$/i;

// GET /valves → lista valvole
app.get("/valves", (req, res) => {
  const valves = getValves();
  res.json(valves);
});

// GET /valves/:id/history → storico temperature
app.get("/valves/:id/history", (req, res) => {
  const valveId = req.params.id;

  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }

  const history = getTemperatureHistory(valveId);
  res.json(history);
});

// POST /setpoint → aggiorna setpoint nel DB
app.post("/setpoint", (req, res) => {
  const { valveId, setpoint } = req.body;

  if (!valveId || typeof setpoint !== "number") {
    return res.status(400).json({ error: "valveId and numeric setpoint are required" });
  }
  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }

  updateSetpoint(valveId, setpoint);
  // 
  updateManualSetpoint(valveId, setpoint);

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
  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
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
  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }
  const success = cancelOverride(valveId);

  if (!success) {
    return res.status(404).json({ error: `No active override for ${valveId}` });
  }

  res.json({ message: "Override cancelled", valveId });
});

// GET /rooms → lista stanze
app.get("/rooms", (req, res) => {
  const rooms = getRooms();
  res.json(rooms);
});

// GET /analytics/rooms → media per stanza e stato aggregato
app.get("/analytics/rooms", (req, res) => {
  const analytics = getRoomAnalytics();
  res.json(analytics);
});

// POST /rooms → crea una stanza
app.post("/rooms", (req, res) => {
  const { id, name, description, globalSetpoint } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: "id and name are required" });
  }

  createRoom(id, name, description, globalSetpoint);

  res.json({ message: "Room created", id, name });
});

// GET /rooms/:id → dettagli stanza
app.get("/rooms/:id", (req, res) => {
  const room = getRoomById(req.params.id);

  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  res.json(room);
});

// PUT /rooms/:id/setpoint -> aggiorna setpoint stanza e sincronizza valvole 
app.put("/rooms/:id/setpoint", (req, res) => {
  const { setpoint } = req.body;
  const roomId = req.params.id;

  if (typeof setpoint !== "number") {
    return res.status(400).json({ error: "setpoint must be a number" });
  }

  //  Aggiorna la stanza
  updateRoomSetpoint(roomId, setpoint);

  //  Prende le valvole
  const associatedValves = getValvesByRoom(roomId);

  //  Cicla le valvole per allineare DB e Controller
  if (Array.isArray(associatedValves)) {
    associatedValves.forEach((v: any) => { // Aggiungo : any per risolvere l'errore di tipo
      updateSetpoint(v.id, setpoint);       
      updateManualSetpoint(v.id, setpoint); 
    });
  }

  console.log(`✅ Sincronizzazione completata per stanza ${roomId}`);

  res.json({ 
    message: "Room setpoint updated and synced to valves", 
    id: roomId, 
    setpoint 
  });
});

// PUT /valves/:valveId/room → assegna valvola a stanza
app.put("/valves/:valveId/room", (req, res) => {
  const { roomId } = req.body;
  const { valveId } = req.params;

  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }
  if (roomId && !getRoomById(roomId)) {
    return res.status(404).json({ error: "Room not found" });
  }

  const assignment = assignValveRoom(valveId, roomId);

  res.json({
    message: "Valve assigned to room",
    valveId,
    roomId: assignment?.roomId ?? null,
    setpoint: assignment?.setpoint ?? 20
  });
});

// GET /rooms/:id/valves → valvole in una stanza
app.get("/rooms/:id/valves", (req, res) => {
  const valves = getValvesByRoom(req.params.id);
  res.json(valves);
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


// DELETE /valves/:id → elimina una valvola
app.delete("/valves/:id", (req, res) => {
  const valveId = req.params.id;

  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }

  deleteValve(valveId);     // DB
  removeValve(valveId);     // Controller

  res.json({ success: true, message: `Valve ${valveId} deleted` });
});

// DELETE /rooms/:id → elimina una stanza e scollega le valvole
app.delete("/rooms/:id", (req, res) => {
  const roomId = req.params.id;

  //  Troviamo le valvole che erano in quella stanza PRIMA di eliminarla
  const associatedValves = getValvesByRoom(roomId);

  /*
  Uso assignValveRoom del CONTROLLER per ogni valvola
  passando 'null', la funzione scollegherà la valvola sia nel DB che nel Controller
  */
  if (Array.isArray(associatedValves)) {
    associatedValves.forEach((v: any) => {
      assignValveRoom(v.id, null); 
    });
  }

  //  Ora che le valvole sono libere, elimino la stanza
  deleteRoom(roomId);

  res.json({ message: "Stanza eliminata e valvole scollegate correttamente" });
});