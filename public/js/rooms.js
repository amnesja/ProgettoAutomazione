let roomsPageData = [];

// 🌟 LETTURA SICURA: Usa la variabile globalizzata per evitare SyntaxError di duplicazione
var API_BASE = window.REST_API_URL || "http://localhost:3001";

async function initRooms() {
  await loadRoomsPage();
  setupRoomForm();
}

/**
 * 🏢 CALL REST API (Express Rooms): Estrae le stanze ed interroga i link fisici strutturati
 */
async function loadRoomsPage() {
  try {
    const rooms = await fetchJson(`${API_BASE}/rooms`);

    roomsPageData = await Promise.all(
      (Array.isArray(rooms) ? rooms : []).map(async (room) => {
        let valves = [];
        try {
          // 🏢 CALL REST API (Express): Chiede le valvole associate a questo specifico ID stanza
          valves = await fetchJson(`${API_BASE}/rooms/${room.id}/valves`);
        } catch (err) {
          console.warn(`Valvole stanza ${room.id} non disponibili:`, err);
        }
        return { ...room, valves: Array.isArray(valves) ? valves : [] };
      })
    );

    renderRoomsMetrics();
    renderRoomsList();
    renderRoomsMessage();
  } catch (err) {
    console.error("Errore caricamento stanze:", err);
    renderRoomsMessage("Non sono riuscito a caricare le stanze (Express Server disconnesso).", "danger");
    const roomsList = document.getElementById("roomsList");
    if (roomsList) {
      roomsList.innerHTML = `<article class="rooms-empty-state">Errore caricando le stanze.</article>`;
    }
  }
}

function renderRoomsMetrics() {
  const container = document.getElementById("roomsMetrics");
  if (!container) return;

  const roomCount = roomsPageData.length;
  const totalValves = roomsPageData.reduce((sum, room) => sum + room.valves.length, 0);
  const avgSetpoint = roomCount
    ? (roomsPageData.reduce((sum, room) => sum + numberOrFallback(room.global_setpoint, 20), 0) / roomCount).toFixed(1)
    : "--";
  const busiestRoom = [...roomsPageData].sort((a, b) => b.valves.length - a.valves.length)[0];

  const metrics = [
    { label: "Stanze", value: roomCount, note: `${totalValves} valvole assegnate` },
    { label: "Setpoint medio", value: `${avgSetpoint}${avgSetpoint === "--" ? "" : "°C"}`, note: "Target globale medio" },
    { label: "Stanza piu piena", value: busiestRoom ? busiestRoom.name : "--", note: busiestRoom ? `${busiestRoom.valves.length} valvole` : "Nessun dato" }
  ];

  container.innerHTML = metrics.map((metric) => `
    <article class="rooms-metric-card">
      <p class="rooms-metric-label">${metric.label}</p>
      <p class="rooms-metric-value">${metric.value}</p>
      <p class="rooms-metric-note">${metric.note}</p>
    </article>
  `).join("");
}

function renderRoomsList() {
  const roomsList = document.getElementById("roomsList");
  if (!roomsList) return;

  if (!roomsPageData.length) {
    roomsList.innerHTML = `<article class="rooms-empty-state">Nessuna stanza disponibile.</article>`;
    return;
  }

  roomsList.innerHTML = roomsPageData.map((room) => {
    const avgTemp = room.valves.length
      ? room.valves.reduce((sum, valve) => sum + numberOrFallback(valve.temperature, 0), 0) / room.valves.length
      : null;
    const heatingOnCount = room.valves.filter((valve) => Boolean(valve.heating)).length;
    const valveBadges = room.valves.length
      ? room.valves.map((valve) => `<span class="dashboard-pill">${valve.id}</span>`).join("")
      : `<span class="dashboard-pill">Nessuna valvola</span>`;

    return `
      <article class="rooms-card">
        <div class="rooms-card-header">
          <div>
            <p class="dashboard-eyebrow">Ambiente</p>
            <h3 class="rooms-card-title">${room.name}</h3>
          </div>
          <div class="rooms-card-setpoint">
            <span>${numberOrFallback(room.global_setpoint, 20).toFixed(1)}°C</span>
          </div>
        </div>
        <p class="rooms-card-description">${room.description || "Nessuna descrizione disponibile."}</p>
        <div class="rooms-card-stats">
          <div class="rooms-stat"><span class="rooms-stat-label">Valvole</span><strong>${room.valves.length}</strong></div>
          <div class="rooms-stat"><span class="rooms-stat-label">Media Temp.</span><strong>${avgTemp != null ? `${Number(avgTemp).toFixed(1)}°C` : "--"}</strong></div>
          <div class="rooms-stat"><span class="rooms-stat-label">Heating ON</span><strong>${heatingOnCount}</strong></div>
        </div>
        <div class="rooms-card-valves">${valveBadges}</div>
        <div class="rooms-card-actions">
          <button class="btn btn-outline-danger btn-sm" onclick="deleteRoomAction('${room.id}')">Cancella</button>
          <button class="btn btn-warning btn-sm" onclick="editRoomSetpoint('${room.id}')">Modifica Setpoint</button>
        </div>
      </article>
    `;
  }).join("");
}

/**
 * 🏢 CALL REST API (Express Nuova Stanza): Registra una nuova entità ambiente nel DB locale
 */
function setupRoomForm() {
  const form = document.getElementById("createRoomForm");
  if (!form || form.dataset.bound === "true") return;

  form.dataset.bound = "true";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("roomId").value;
    const name = document.getElementById("roomName").value;
    const description = document.getElementById("roomDescription").value;
    const globalSetpoint = parseFloat(document.getElementById("globalSetpoint").value);

    try {
      await fetchJson(`${API_BASE}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name, description, globalSetpoint })
      });

      bootstrap.Modal.getInstance(document.getElementById("createRoomModal")).hide();
      form.reset();
      document.getElementById("globalSetpoint").value = "20";
      renderRoomsMessage(`Stanza ${name} creata con successo.`, "success");
      await loadRoomsPage();
    } catch (err) {
      console.error("Errore creazione stanza:", err);
      renderRoomsMessage("Non sono riuscito a creare la stanza.", "danger");
    }
  });
}

function viewRoomValves(roomId) {
  const room = roomsPageData.find((item) => item.id === roomId);
  if (!room) return;
  const valveNames = room.valves.length ? room.valves.map((valve) => valve.id).join(", ") : "nessuna valvola assegnata";
  renderRoomsMessage(`Valvole in ${room.name}: ${valveNames}.`, "info");
}

/**
 * 🏢 CALL REST API (Express Setpoint Cascata): Invia un target comune. 
 * Sarà poi Express a propagare l'aggiornamento verso ogni Thing WoT associata.
 */
async function editRoomSetpoint(roomId) {
  const room = roomsPageData.find((item) => item.id === roomId);
  const currentSetpoint = room ? numberOrFallback(room.global_setpoint, 20) : 20;
  const newSetpoint = prompt("Nuovo setpoint globale per la stanza e tutte le sue valvole:", currentSetpoint);

  if (!newSetpoint) return;

  try {
    await fetchJson(`${API_BASE}/rooms/${roomId}/setpoint`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setpoint: parseFloat(newSetpoint) })
    });

    renderRoomsMessage(`Setpoint aggiornato e sincronizzato per ${room?.name || roomId}.`, "success");
    await loadRoomsPage();
  } catch (err) {
    console.error("Errore aggiornando setpoint stanza:", err);
    renderRoomsMessage("Non sono riuscito ad aggiornare il setpoint della stanza.", "danger");
  }
}

function renderRoomsMessage(message = "", type = "info") {
  const container = document.getElementById("roomsMessage");
  if (!container) return;

  if (!message) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="alert alert-${type} py-2 mb-0" role="alert">${message}</div>`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

function numberOrFallback(value, fallback) {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

/**
 * 🏢 CALL REST API (Express Delete Room): Rimuove la stanza lasciando libere le valvole sul database
 */
async function deleteRoomAction(roomId) {
  const confirmed = confirm(`Sei sicuro di voler eliminare la stanza "${roomId}"? Le valvole associate verranno liberate sia sul DB che sul Controller.`);
  if (!confirmed) return;

  try {
    await fetchJson(`${API_BASE}/rooms/${roomId}`, { method: "DELETE" });
    renderRoomsMessage(`Stanza ${roomId} eliminata con successo e valvole scollegate.`, "success");
    await loadRoomsPage(); 
  } catch (err) {
    console.error("Errore eliminazione stanza:", err);
    renderRoomsMessage("Non sono riuscito a eliminare la stanza.", "danger");
  }
}