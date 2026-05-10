export type LogEventType =
  | "VALVE_ASSIGNED"
  | "VALVE_DETACHED"
  | "VALVE_REMOVED_FROM_CONTROLLER"
  | "VALVE_DELETED"
  | "SETPOINT_CHANGED"
  | "ROOM_CREATED"
  | "ROOM_DELETED";

function isoNow(): string {
  return new Date().toISOString();
}

function payloadToString(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    parts.push(`${k}=${String(v)}`);
  }
  return parts.join(" ");
}

export function logEvent(
  type: LogEventType,
  payload: Record<string, unknown> = {}
) {
  // Formato simile ai log già esistenti: emoticon + messaggio leggibile
  // (senza JSON ripetitivo)
  const ts = isoNow();
  const msg = payloadToString(payload);
  console.log(`${ts} ${type}${msg ? ` ${msg}` : ""}`);
}

