let roomsPageData = [];

async function initRooms() {
  await loadRoomsPage();
  setupRoomForm();
}

async function loadRoomsPage() {
  try {
    const rooms = await fetchJson("/rooms");

    roomsPageData = await Promise.all(
      (Array.isArray(rooms) ? rooms : []).map(async (room) => {
        let valves = [];

        try {
          valves = await fetchJson(`/rooms/${room.id}/valves`);
        } catch (err) {
          console.warn(`Valvole stanza ${room.id} non disponibili:`, err);
        }

        return {
          ...room,
          valves: Array.isArray(valves) ? valves : []
        };
      })
    );

    renderRoomsMetrics();
    renderRoomsList();
    renderRoomsMessage();
  } catch (err) {
    console.error("Errore caricamento stanze:", err);
    renderRoomsMessage("Non sono riuscito a caricare le stanze.", "danger");
    const roomsList = document.getElementById("roomsList");
    if (roomsList) {
      roomsList.innerHTML = `<article class="rooms-empty-state">Errore caricando le stanze.</article>`;
    }
  }
}

function renderRoomsMetrics() {
  const container = document.getElementById("roomsMetrics");
  if (!container) {
    return;
  }

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
  if (!roomsList) {
    return;
  }

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
          <div class="rooms-stat">
            <span class="rooms-stat-label">Valvole</span>
            <strong>${room.valves.length}</strong>
          </div>
          <div class="rooms-stat">
            <span class="rooms-stat-label">Media Temp.</span>
            <strong>${avgTemp != null ? `${Number(avgTemp).toFixed(1)}°C` : "--"}</strong>
          </div>
          <div class="rooms-stat">
            <span class="rooms-stat-label">Heating ON</span>
            <strong>${heatingOnCount}</strong>
          </div>
        </div>

        <div class="rooms-card-valves">
          ${valveBadges}
        </div>


        <div class="rooms-card-actions">
          <button class="btn btn-warning btn-sm" onclick="editRoomSetpoint('${room.id}')">Modifica Setpoint</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRoom('${room.id}')">Elimina</button>
        </div>

      </article>
    `;
  }).join("");
}

function setupRoomForm() {
  const form = document.getElementById("createRoomForm");
  if (!form || form.dataset.bound === "true") {
    return;
  }

  form.dataset.bound = "true";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("roomId").value;
    const name = document.getElementById("roomName").value;
    const description = document.getElementById("roomDescription").value;
    const globalSetpoint = parseFloat(document.getElementById("globalSetpoint").value);

    try {
      await fetchJson("/rooms", {
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





async function editRoomSetpoint(roomId) {
  const room = roomsPageData.find((item) => item.id === roomId);
  const currentSetpoint = room ? numberOrFallback(room.global_setpoint, 20) : 20;
  const newSetpoint = prompt("Nuovo setpoint globale:", currentSetpoint);

  if (!newSetpoint) {
    return;
  }

  try {
    await fetchJson(`/rooms/${roomId}/setpoint`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setpoint: parseFloat(newSetpoint) })
    });

    renderRoomsMessage(`Setpoint aggiornato per ${room?.name || roomId}.`, "success");
    await loadRoomsPage();
  } catch (err) {
    console.error("Errore aggiornando setpoint stanza:", err);
    renderRoomsMessage("Non sono riuscito ad aggiornare il setpoint della stanza.", "danger");
  }
}

async function deleteRoom(roomId) {
  const room = roomsPageData.find((item) => item.id === roomId);
  const roomName = room ? room.name : roomId;

  if (!confirm(`Sei sicuro di voler eliminare la stanza "${roomName}"?`)) {
    return;
  }

  try {
    await fetchJson(`/rooms/${roomId}`, {
      method: "DELETE"
    });

    renderRoomsMessage(`Stanza "${roomName}" eliminata.`, "success");
    await loadRoomsPage();
  } catch (err) {
    console.error("Errore eliminando stanza:", err);
    renderRoomsMessage("Non sono riuscito ad eliminare la stanza.", "danger");
  }
}

function renderRoomsMessage(message = "", type = "info") {
  const container = document.getElementById("roomsMessage");
  if (!container) {
    return;
  }

  if (!message) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="alert alert-${type} py-2 mb-0" role="alert">
      ${message}
    </div>
  `;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }

  return res.json();
}

function numberOrFallback(value, fallback) {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}
