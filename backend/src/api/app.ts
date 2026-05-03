import express from "express";
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
  propagateRoomSetpoint,
  getValvesByRoom,
  getRoomAnalytics,
  deleteValve,
  deleteRoom
} from "../db/repository.js";
import { setOverride, getActiveOverrides, cancelOverride, assignValveRoom, removeValve, setManualSetpoint } from "../controller/controller.js";
import { env } from "../config/env.js";

const VALID_VALVE_ID = /^valve\d+$/i;

function getDirname(importMetaUrl: string) {
  const __filename = fileURLToPath(importMetaUrl);
  return path.dirname(__filename);
}

export function createApiApp(options: { serveFrontend: boolean }) {
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

    if (!VALID_VALVE_ID.test(valveId)) {
      return res.status(400).json({ error: "Invalid valve id format" });
    }

    const history = getTemperatureHistory(valveId);
    res.json(history);
  });

  // POST /setpoint → aggiorna setpoint nel DB
  app.post("/setpoint", (req, res) => {
    const { valveId, setpoint } = req.body as { valveId?: string; setpoint?: unknown };

    if (!valveId || typeof setpoint !== "number") {
      return res.status(400).json({ error: "valveId and numeric setpoint are required" });
    }
    if (!VALID_VALVE_ID.test(valveId)) {
      return res.status(400).json({ error: "Invalid valve id format" });
    }

    updateSetpoint(valveId, setpoint);
    setManualSetpoint(valveId, setpoint);

    res.json({ message: "Setpoint updated", valveId, setpoint });
  });

  // POST /override → attiva un override manuale
  app.post("/override", (req, res) => {
    const { valveId, state, duration } = req.body as {
      valveId?: string;
      state?: unknown;
      duration?: unknown;
    };

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
    const { id, name, description, globalSetpoint } = req.body as {
      id?: string;
      name?: string;
      description?: string;
      globalSetpoint?: unknown;
    };

    if (!id || !name) {
      return res.status(400).json({ error: "id and name are required" });
    }

    const parsedSetpoint = typeof globalSetpoint === "number" ? globalSetpoint : undefined;
    createRoom(id, name, description, parsedSetpoint);

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

  // PUT /rooms/:id/setpoint → aggiorna setpoint globale stanza
  app.put("/rooms/:id/setpoint", (req, res) => {
    const id = req.params.id;
    const { setpoint } = req.body as { setpoint?: unknown };

    if (typeof setpoint !== "number") {
      return res.status(400).json({ error: "setpoint must be a number" });
    }

    updateRoomSetpoint(id, setpoint);
    const changes = propagateRoomSetpoint(id);
    res.json({ message: "Room setpoint updated", id, setpoint, propagated: changes });
  });

  // PUT /valves/:valveId/room → assegna valvola a stanza
  app.put("/valves/:valveId/room", (req, res) => {
    const { roomId } = req.body as { roomId?: string | null };
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

  // DELETE /rooms/:id → elimina una stanza
  app.delete("/rooms/:id", (req, res) => {
    const roomId = req.params.id;

    // verifica che la stanza esista
    const room = getRoomById(roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    deleteRoom(roomId);

    res.json({ success: true, message: `Room ${roomId} deleted` });
  });

  // DELETE /valves/:id → elimina una valvola
  app.delete("/valves/:id", (req, res) => {
    const valveId = req.params.id;

    if (!VALID_VALVE_ID.test(valveId)) {
      return res.status(400).json({ error: "Invalid valve id format" });
    }

    deleteValve(valveId); // DB
    removeValve(valveId); // Controller

    res.json({ success: true, message: `Valve ${valveId} deleted` });
  });

if (options.serveFrontend) {
    const __dirname = getDirname(import.meta.url);
    const frontendRoot = path.join(__dirname, "../../../", env.FRONTEND_DIR);

    app.use(express.static(frontendRoot));

    // Serve index.html for root route
    app.get("/", (req, res) => {
      res.sendFile(path.join(frontendRoot, "index.html"));
    });
  }

  return app;
}
