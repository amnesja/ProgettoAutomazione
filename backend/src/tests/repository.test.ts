import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.SQLITE_DB_PATH = ":memory:";

type ValveRow = {
  id: string;
  setpoint: number;
  heating: number | 0 | 1;
  status: string;
  temperature: number | null;
  room_id: string | null;
};

type RoomRow = {
  id: string;
  name: string;
  description: string | null;
  global_setpoint: number;
};

type TemperatureHistoryRow = {
  valve_id: string;
  temperature: number;
};

type RoomAnalyticsRow = {
  id: string;
  name: string;
  global_setpoint: number;
  valve_count: number;
  avg_temperature: number;
  heating_on_count: number;
};

const dbModule = await import("../db/database.js");
const repoModule = (await import("../db/repository.js")) as typeof import("../db/repository.js");

const db = dbModule.default as { exec: (sql: string) => void };

const {
  upsertValve,
  insertTemperature,
  getValves,
  updateSetpoint,
  deleteValve,
  createRoom,
  getRooms,
  getRoomById,
  updateRoomSetpoint,
  assignValveToRoom,
  getValvesByRoom,
  getTemperatureHistory,
  getRoomAnalytics
} = repoModule;

describe("repository (SQLite)", () => {
  beforeEach(() => {
    db.exec("DELETE FROM temperature_readings;");
    db.exec("DELETE FROM valves;");
    db.exec("DELETE FROM rooms;");
  });

  test("upsertValve + getValves returns only valid valve ids", () => {
    upsertValve("valve1", 21, false, 20.5, undefined);
    upsertValve("invalid", 21, false, 20.5, undefined);

    const valves = getValves() as ValveRow[];
    assert.equal(valves.length, 1);
    assert.equal(valves[0].id, "valve1");
    assert.equal(valves[0].setpoint, 21);
  });

  test("updateSetpoint updates valve setpoint", () => {
    upsertValve("valve1", 21, false, 20.5, undefined);
    updateSetpoint("valve1", 22);

    const valves = getValves() as ValveRow[];
    assert.equal(valves[0].setpoint, 22);
  });

  test("insertTemperature + getTemperatureHistory returns latest 50", () => {
    upsertValve("valve1", 21, false);

    for (let i = 0; i < 55; i++) {
      insertTemperature("valve1", 20 + i * 0.1);
    }

    const history = getTemperatureHistory("valve1") as TemperatureHistoryRow[];
    assert.equal(history.length, 50);
    assert.equal(history[0].valve_id, "valve1");
    assert.ok(typeof history[0].temperature === "number");
  });

  test("createRoom + getRooms + getRoomById + updateRoomSetpoint", () => {
    createRoom("room1", "Soggiorno", "Zona giorno", 21);

    const rooms = getRooms() as RoomRow[];
    assert.equal(rooms.length, 1);

    const room = getRoomById("room1") as RoomRow | undefined;
    assert.equal(room?.id, "room1");
    assert.equal(room?.global_setpoint, 21);

    updateRoomSetpoint("room1", 22);
    const updated = getRoomById("room1") as RoomRow | undefined;
    assert.equal(updated?.global_setpoint, 22);
  });

  test("assignValveToRoom sets room_id and setpoint, status OFFLINE", () => {
    createRoom("room1", "Soggiorno", "Zona giorno", 23);

    const assignment = assignValveToRoom("valve1", "room1");
    assert.deepEqual(assignment, { roomId: "room1", setpoint: 23 });

    const valves = getValvesByRoom("room1") as ValveRow[];
    assert.equal(valves.length, 1);
    assert.equal(valves[0].room_id, "room1");
    assert.equal(valves[0].setpoint, 23);
    assert.equal(valves[0].status, "OFFLINE");
  });

  test("getRoomAnalytics aggregates avg temperature and heating_on_count", () => {
    createRoom("room1", "Soggiorno", "Zona giorno", 21);

    upsertValve("valve1", 21, true, 20.0, "room1");
    upsertValve("valve2", 21, false, 22.0, "room1");

    const analytics = getRoomAnalytics() as RoomAnalyticsRow[];
    assert.equal(analytics.length, 1);
    assert.equal(analytics[0].id, "room1");
    assert.equal(analytics[0].valve_count, 2);
    assert.ok(analytics[0].heating_on_count === 1);
    // AVG(20.0, 22.0) = 21.0 
    assert.equal(analytics[0].avg_temperature, 21);
  });

  test("deleteValve removes valve and its history", () => {
    upsertValve("valve1", 21, false);
    insertTemperature("valve1", 20.5);
    assert.equal(getTemperatureHistory("valve1").length, 1);

    deleteValve("valve1");
    assert.equal(getValves().length, 0);
    assert.equal(getTemperatureHistory("valve1").length, 0);
  });
});
