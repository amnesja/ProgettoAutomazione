let settingsRefreshTimer = null;

// INIT 

async function initSettings() {
  if (settingsRefreshTimer) {
    clearInterval(settingsRefreshTimer);
  }

  await renderSettingsPage();

  // Aggiorna tutta la pagina ogni 20 secondi
  settingsRefreshTimer = setInterval(renderSettingsPage, 20000);

  // 🔥 Aggiorna solo lo stato attuale ogni 3 secondi
  setInterval(refreshLiveStatus, 3000);
}

// 🔥 NUOVA FUNZIONE: aggiorna solo il blocco “Stato attuale”
async function refreshLiveStatus() {
  const valveId = window.selectedValve;
  if (!valveId) return;

  const baseUrl = "http://localhost:8081";

  try {
    const temperature = await fetchJson(`${baseUrl}/valve-${valveId}/properties/temperature`);
    const heating = await fetchJson(`${baseUrl}/valve-${valveId}/properties/heating`);

    const valvesDb = await fetchJson("/valves");
    const valveDb = valvesDb.find(v => v.id === valveId);
    const last_seen = valveDb?.last_seen ?? "N/A";

    // Aggiorna SOLO i valori live
    document.getElementById("liveTemp").textContent = Number(temperature).toFixed(1);
    document.getElementById("liveHeating").textContent = heating ? "🔥 ON" : "❄️ OFF";
    document.getElementById("liveLastSeen").textContent = last_seen;

  } catch (err) {
    console.warn("Errore refresh live:", err);
  }
}

// RENDER PRINCIPALE

async function renderSettingsPage() {
  let valveId = window.selectedValve || localStorage.getItem("settingsSelectedValve");
  const container = document.getElementById("settingsContent");

  const baseUrl = "http://localhost:8081";

  // Lista valvole dal WoT
  const valveList = await fetchJson(`${baseUrl}/valvedirectory/properties/valves`);
  const valves = Array.isArray(valveList) ? valveList : [];

  if (valveId && !valves.includes(valveId)) {
    valveId = null;
    localStorage.removeItem("settingsSelectedValve");
  }

  // Selettore sempre visibile
  const selectorHtml = `
    <article class="rooms-card w-45">
      <div class="settings-card">
        <h4>Seleziona una valvola</h4>

        <select id="settingsValveSelect" class="form-select w-auto">
          ${valves.map(v => `
            <option value="${v}" ${v === valveId ? "selected" : ""}>${v}</option>
          `).join("")}
        </select>

        <div class="d-flex gap-2 mt-2">
          <button class="btn btn-primary" onclick="selectValveForSettings()">Apri impostazioni</button>

          <button class="btn btn-danger" onclick="deleteSelectedValve()">
            Elimina
          </button>
        </div>
      </div>
    </article>
  `;

  if (!valveId) {
    container.innerHTML = selectorHtml;
    return;
  }

  window.selectedValve = valveId;
  localStorage.setItem("settingsSelectedValve", valveId);

  //  Dati LIVE dal WoT
  const temperature = await fetchJson(`${baseUrl}/valve-${valveId}/properties/temperature`);
  const heating = await fetchJson(`${baseUrl}/valve-${valveId}/properties/heating`);

  // Dati PERSISTENTI dal backend REST
  const valvesDb = await fetchJson("/valves");
  const valveDb = valvesDb.find(v => v.id === valveId);

  const setpoint = valveDb?.setpoint ?? 20;
  const room_id = valveDb?.room_id ?? "";
  const last_seen = valveDb?.last_seen ?? "N/A";

  const rooms = await fetchJson("/rooms");
  const overrides = await fetchJson("/overrides");
  const activeOverride = overrides.active[valveId];

  document.getElementById("settingsTitle").textContent = `Impostazioni per ${valveId}`;

  container.innerHTML = `
    <div class="d-flex justify-content-between align-items-start gap-3">

      ${selectorHtml}

      <article class="rooms-card w-50">
        <div class="settings-card">
          <h4>Stato attuale</h4>
          <p><strong>Temperatura:</strong> <span id="liveTemp">${Number(temperature).toFixed(1)}</span>°C</p>
          <p><strong>Setpoint:</strong> ${setpoint}°C</p>
          <p><strong>Heating:</strong> <span id="liveHeating">${heating ? "🔥 ON" : "❄️ OFF"}</span></p>
          <p><strong>Ultima lettura:</strong> <span id="liveLastSeen">${last_seen}</span></p>
          <p><strong>Stanza:</strong> ${room_id || "Nessuna"}</p>
        </div>
      </article>

    </div>

    <article class="rooms-card w-100 mt-3 mb-2">

      <div class="d-flex justify-content-between align-items-start gap-0">

        <!-- SINISTRA: Setpoint + Stanza -->
        <div class="d-flex flex-column gap-1 w-25">

          <div class="settings-card">
            <h4>Modifica Setpoint</h4>
            <input id="newSetpoint" type="number" class="form-control w-auto" value="${setpoint}">
            <button class="btn btn-primary mt-2" onclick="updateSetpoint('${valveId}')">Aggiorna</button>
          </div>

          <div class="settings-card">
            <h4>Assegna Stanza</h4>

            <select id="roomSelect" class="form-select w-auto" onchange="updateRoomButton('${valveId}', '${room_id}')">
                <option value="">Nessuna</option>
                ${rooms.map(r => `<option value="${r.id}" ${r.id === room_id ? "selected" : ""}>${r.name}</option>`).join("")}
            </select>

            <div id="roomActionButton">
              ${
                room_id
                  ? `<button class="btn btn-danger mt-2" onclick="removeRoomFromValve('${valveId}')">Rimuovi</button>`
                  : `<button class="btn btn-success mt-2" onclick="assignRoomSettings('${valveId}')">Assegna</button>`
              }
            </div>
          </div>

        </div>

        <!-- DESTRA: Override Manuale -->
        <div class="w-75">
          <div class="settings-card">
            <h4>Override Manuale</h4>
            <p>Stato attuale: ${activeOverride ? `Attivo (${activeOverride.remainingSeconds}s)` : "Nessuno"}</p>

            <select id="overrideState" class="form-select w-100">
              <option value="true">ON</option>
              <option value="false">OFF</option>
            </select>

            <input id="overrideDuration" type="number" class="form-control mt-2 w-100" placeholder="Durata in secondi" value="60">

            <button class="btn btn-warning mt-2" onclick="activateOverride('${valveId}')">Attiva Override</button>

            ${activeOverride ? `<button class="btn btn-danger mt-2" onclick="cancelOverrideSettings('${valveId}')">Cancella Override</button>` : ""}
          </div>
        </div>

      </div>

    </article>

  `;
}

// SELETTORE VALVOLA 

function selectValveForSettings() {
  const valveId = document.getElementById("settingsValveSelect").value;
  window.selectedValve = valveId;
  localStorage.setItem("settingsSelectedValve", valveId);
  renderSettingsPage();
}

// ACTIONS (REST BACKEND)

async function updateSetpoint(valveId) {
  await fetchJson("/setpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valveId, setpoint: Number(document.getElementById("newSetpoint").value) })
  });
  renderSettingsPage();
}

async function assignRoomSettings(valveId) {
  await fetchJson(`/valves/${valveId}/room`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: document.getElementById("roomSelect").value })
  });
  renderSettingsPage();
}

async function removeRoomFromValve(valveId) {
  await fetchJson(`/valves/${valveId}/room`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: null })
  });
  renderSettingsPage();
}

function updateRoomButton(valveId, currentRoomId) {
  const selected = document.getElementById("roomSelect").value;
  const container = document.getElementById("roomActionButton");

  if (selected === currentRoomId && selected !== "") {
    container.innerHTML = `
      <button class="btn btn-danger mt-2" onclick="removeRoomFromValve('${valveId}')">Rimuovi</button>
    `;
  } else {
    container.innerHTML = `
      <button class="btn btn-success mt-2" onclick="assignRoomSettings('${valveId}')">Assegna</button>
    `;
  }
}

async function activateOverride(valveId) {
  await fetchJson("/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      valveId,
      state: document.getElementById("overrideState").value === "true",
      duration: Number(document.getElementById("overrideDuration").value)
    })
  });
  renderSettingsPage();
}

async function cancelOverrideSettings(valveId) {
  await fetchJson(`/override/${valveId}`, { method: "DELETE" });
  renderSettingsPage();
}

async function deleteSelectedValve() {
  const select = document.getElementById("settingsValveSelect");
  const valveId = select.value;

  if (!valveId) {
    alert("Seleziona una valvola da eliminare.");
    return;
  }

  const confirmDelete = confirm(`Sei sicuro di voler eliminare ${valveId}?`);
  if (!confirmDelete) return;

  try {
    //  Elimina dal DB + controller
    await fetch(`/valves/${valveId}`, { method: "DELETE" });

    // Elimina il Thing WoT
    await fetch(`http://localhost:8081/valve-${valveId}/actions/delete`, {
      method: "POST"
    });

    // Aggiorna UI
    renderSettingsPage();

  } catch (err) {
    console.error("Errore eliminazione valvola:", err);
    alert("Errore durante l'eliminazione della valvola.");
  }
}
