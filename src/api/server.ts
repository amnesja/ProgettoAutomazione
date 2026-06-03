import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { 
  getValves, 
  getTemperatureHistory, 
  updateSetpoint, 
  createRoom, 
  getRooms, 
  getRoomById, 
  updateRoomSetpoint, 
  getValvesByRoom, 
  getRoomAnalytics, 
  deleteValve, 
  deleteRoom 
} from "../db/repository.js";
import { 
  setOverride, 
  getActiveOverrides, 
  cancelOverride, 
  assignValveRoom, 
  removeValve, 
  updateManualSetpoint 
} from "../controller/controller.js";

dotenv.config();

const app = express();
app.use(express.json());

const VALID_VALVE_ID = /^valve\d+$/i;
const WOT_HTTP_URL = `http://localhost:${process.env.WOT_PORT || 8081}`;

// SEZIONE VALVOLE & STORICO (REST interroga DB / Controller coordina)


// GET /valves → Lista configurazioni valvole da DB
app.get("/valves", (req, res) => {
  res.json(getValves());
});

// GET /valves/:id/history → Storico temperature per i grafici del Frontend
app.get("/valves/:id/history", (req, res) => {
  const valveId = req.params.id;
  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }
  res.json(getTemperatureHistory(valveId));
});


// DELETE /valves/:id → Elimina definitivamente la valvola da tutto il sistema
app.delete("/valves/:id", async (req, res) => {
  const valveId = req.params.id;

  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }

  try {
    // Invocazione dell'azione di cancellazione verso il Server WoT per distruggere la Thing
    await fetch(`${WOT_HTTP_URL}/valve-${valveId}/actions/delete`, { method: 'POST' });
    console.log(`🗑️ [WoT Action] Invocata eliminazione della Thing valve-${valveId}`);
  } catch (err: any) {
    console.warn(`⚠️ Impossibile comunicare la cancellazione al Server WoT (forse già spento):`, err.message);
  }

  deleteValve(valveId);     // Rimuove dal DB locale
  removeValve(valveId);     // Rimuove dalla RAM del Controller e fa l'unsubscribed MQTT

  res.json({ success: true, message: `Valve ${valveId} removed completely from DB, Controller and WoT` });
});


// SEZIONE OVERRIDE (Invocano i metodi operativi del Controller)


// POST /override → Attiva override manuale temporizzato
app.post("/override", (req, res) => {
  const { valveId, state, duration } = req.body;

  if (!valveId || typeof state !== "boolean" || typeof duration !== "number" || duration <= 0) {
    return res.status(400).json({ error: "Invalid fields. valveId, state (bool) and duration (>0) are required" });
  }
  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }

  const success = setOverride(valveId, state, duration); // Fa partire il timer nel controller ed emette la Fetch HTTP
  if (!success) {
    return res.status(404).json({ error: `Valve ${valveId} not monitored by controller` });
  }

  res.json({
    message: "Manual override activated",
    valveId,
    state: state ? "ON" : "OFF",
    duration,
    expiresAt: new Date(Date.now() + duration * 1000).toISOString()
  });
});

// GET /overrides → Lista dei timer attivi nel controller
app.get("/overrides", (req, res) => {
  const active = getActiveOverrides();
  res.json({ active, count: Object.keys(active).length });
});

// DELETE /override/:valveId → Interrompe anticipatamente un override
app.delete("/override/:valveId", (req, res) => {
  const { valveId } = req.params;
  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }

  const success = cancelOverride(valveId); // Rimuove il timer in RAM e ridà il controllo all'isteresi
  if (!success) {
    return res.status(404).json({ error: `No active override found for ${valveId}` });
  }

  res.json({ message: "Override cancelled successfully", valveId });
});


// SEZIONE STANZE & ASSEGNAMENTI (Business logica e cascata dati)


// GET /rooms → Lista stanze
app.get("/rooms", (req, res) => {
  res.json(getRooms());
});

// POST /rooms → Creazione nuova stanza
app.post("/rooms", (req, res) => {
  const { id, name, description, globalSetpoint } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "id and name are required" });
  }

  createRoom(id, name, description, globalSetpoint || 20);
  res.json({ message: "Room created successfully", id, name });
});

// GET /rooms/:id → Dettaglio singola stanza
app.get("/rooms/:id", (req, res) => {
  const room = getRoomById(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// GET /analytics/rooms → Calcolo aggregato medie temperature per stanza
app.get("/analytics/rooms", (req, res) => {
  res.json(getRoomAnalytics());
});

// PUT /valves/:valveId/room → Assegna o scollega una valvola da una stanza
app.put("/valves/:valveId/room", (req, res) => {
  const { roomId } = req.body; // Se roomId è null/empty, scollega la valvola
  const { valveId } = req.params;

  if (!VALID_VALVE_ID.test(valveId)) {
    return res.status(400).json({ error: "Invalid valve id format" });
  }
  if (roomId && !getRoomById(roomId)) {
    return res.status(404).json({ error: "Target room not found" });
  }

  // Il controller si occupa di aggiornare il DB, allineare la propria RAM 
  // e lanciare la Fetch HTTP per cambiare il setpoint della valvola con quello della stanza
  const assignment = assignValveRoom(valveId, roomId);

  res.json({
    message: roomId ? "Valve assigned to room" : "Valve detached from room",
    valveId,
    roomId: assignment?.roomId ?? null,
    setpoint: assignment?.setpoint ?? 20
  });
});

// PUT /rooms/:id/setpoint → Modifica il setpoint globale della stanza ed esegue l'aggiornamento a cascata
app.put("/rooms/:id/setpoint", (req, res) => {
  const { setpoint } = req.body;
  const roomId = req.params.id;

  if (typeof setpoint !== "number") {
    return res.status(400).json({ error: "setpoint must be a valid number" });
  }

  updateRoomSetpoint(roomId, setpoint); // Aggiorna il setpoint della stanza nel DB
  const associatedValves = getValvesByRoom(roomId); // Recupera le valvole in quella stanza

  // Forza l'allineamento a cascata sia sul DB delle valvole che sul WoT hardware
  if (Array.isArray(associatedValves)) {
    associatedValves.forEach((v: any) => {
      updateSetpoint(v.id, setpoint);       
      updateManualSetpoint(v.id, setpoint); 
    });
  }

  console.log(`✅ Sincronizzazione a cascata completata per la stanza: ${roomId}`);
  res.json({ message: "Room setpoint updated and cascaded to all room valves", id: roomId, setpoint });
});

// GET /rooms/:id/valves → Lista valvole dentro una stanza
app.get("/rooms/:id/valves", (req, res) => {
  res.json(getValvesByRoom(req.params.id));
});

// DELETE /rooms/:id → Rimuove una stanza e libera le valvole agganciate
app.delete("/rooms/:id", (req, res) => {
  const roomId = req.params.id;
  const associatedValves = getValvesByRoom(roomId);

  // Sgancia preventivamente tutte le valvole associate passandole a null nel controller
  if (Array.isArray(associatedValves)) {
    associatedValves.forEach((v: any) => {
      assignValveRoom(v.id, null); 
    });
  }

  deleteRoom(roomId); // Ora la stanza è vuota e può essere rimossa dal DB safely
  res.json({ message: "Room deleted and nested valves detached successfully" });
});


// SERVING STATIC FILES & BOOT

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "../../public")));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ REST API Server running on port ${PORT}`);
});