let settingsRefreshTimer = null;

// INIT 
async function initSettings() {
  if (settingsRefreshTimer) {
    clearInterval(settingsRefreshTimer);
  }

  await renderSettingsPage();

  // Aggiorna tutta la pagina ogni 20 secondi
  settingsRefreshTimer = setInterval(renderSettingsPage, 20000);

  // Aggiorna solo i dati numerici ogni 3 secondi
  setInterval(refreshLiveStatus, 3000);
}

// AGGIORNA SOLO I DATI 
async function refreshLiveStatus() {
  const valveId = window.selectedValve;
  if (!valveId) return;

  const baseUrl = "http://localhost:8081";

  try {
    // Dati dal Simulatore WoT
    const temperature = await fetchJson(`${baseUrl}/valve-${valveId}/properties/temperature`);
    const heating = await fetchJson(`${baseUrl}/valve-${valveId}/properties/heating`);

    // Dati dal Database REST
    const valvesDb = await fetchJson("/valves");
    
    // Cerchiamo la valvola provando sia l'ID intero che quello pulito (es. valve-1 vs 1)
    const valveDb = valvesDb.find(v => v.id == valveId || v.id == valveId.replace("valve-", ""));
    
    const last_seen = valveDb?.last_seen ?? "N/A";
    const setpoint = valveDb?.setpoint ?? 20;

    //  Aggiornamento DOM (elementi identificati tramite ID)
    if (document.getElementById("liveTemp")) 
      document.getElementById("liveTemp").textContent = Number(temperature).toFixed(1);
    
    if (document.getElementById("liveHeating")) 
      document.getElementById("liveHeating").textContent = heating ? "🔥 ON" : "❄️ OFF";
    
    if (document.getElementById("liveLastSeen")) 
      document.getElementById("liveLastSeen").textContent = last_seen;

    if (document.getElementById("liveSetpointDisplay")) 
      document.getElementById("liveSetpointDisplay").textContent = setpoint;

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

  // Selettore
  const selectorHtml = `
    <article class="rooms-card" style="flex: 1; min-width: 250px; max-width: 350px;">
      <div class="settings-card">
        <h5>Seleziona Valvola</h5>
        <select id="settingsValveSelect" class="form-select">
          ${valves.map(v => `<option value="${v}" ${v === valveId ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-primary btn-sm" onclick="selectValveForSettings()">Apri</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSelectedValve()">Elimina</button>
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

  // Fetch dati iniziali
  const temperature = await fetchJson(`${baseUrl}/valve-${valveId}/properties/temperature`);
  const heating = await fetchJson(`${baseUrl}/valve-${valveId}/properties/heating`);
  const valvesDb = await fetchJson("/valves");
  const valveDb = valvesDb.find(v => v.id == valveId || v.id == valveId.replace("valve-", ""));

  const setpoint = valveDb?.setpoint ?? 20;
  const room_id = valveDb?.room_id ?? "";
  const last_seen = valveDb?.last_seen ?? "N/A";
  const rooms = await fetchJson("/rooms");
  const overrides = await fetchJson("/overrides");
  const activeOverride = overrides.active[valveId];

  document.getElementById("settingsTitle").textContent = `Impostazioni: ${valveId}`;

  container.innerHTML = `
    <div class="d-flex flex-column gap-3">
      
      <!-- RIGA 1: Selettore e Stato -->
      <div class="d-flex justify-content-between gap-3 flex-wrap">
        ${selectorHtml}

        <article class="rooms-card" style="flex: 2; min-width: 280px;">
          <div class="settings-card">
            <h5>Stato Attuale</h5>
            <div class="d-flex gap-4 flex-wrap mt-2">
              <div><strong>Temp:</strong> <span id="liveTemp">${Number(temperature).toFixed(1)}</span>°C</div>
              <div><strong>Setpoint:</strong> <span id="liveSetpointDisplay">${setpoint}</span>°C</div>
              <div><span id="liveHeating">${heating ? "🔥 ON" : "❄️ OFF"}</span></div>
            </div>
            <p class="mb-0 mt-3 small"><strong>Stanza:</strong> ${room_id || "Nessuna"}</p>
            <p class="mb-0 text-muted small">Ultima lettura: <span id="liveLastSeen">${last_seen}</span></p>
          </div>
        </article>
      </div>

      <!-- RIGA 2: Azioni Organizzate -->
      <div class="d-flex justify-content-between gap-3 flex-wrap">
        
        <!-- Modifica Setpoint -->
        <article class="rooms-card" style="flex: 1; min-width: 220px;">
          <div class="settings-card">
            <h5>Modifica Setpoint</h5>
            <div class="d-flex gap-2 mt-2">
              <input id="newSetpoint" type="number" class="form-control form-control-sm" value="${setpoint}" step="0.5">
              <button class="btn btn-primary btn-sm" onclick="updateSetpoint('${valveId}')">Salva</button>
            </div>
          </div>
        </article>

        <!-- Assegna Stanza -->
        <article class="rooms-card" style="flex: 1; min-width: 220px;">
          <div class="settings-card">
            <h5>Stanza</h5>
            <select id="roomSelect" class="form-select form-select-sm" onchange="updateRoomButton('${valveId}', '${room_id}')">
                <option value="">Nessuna</option>
                ${rooms.map(r => `<option value="${r.id}" ${r.id === room_id ? "selected" : ""}>${r.name}</option>`).join("")}
            </select>
            <div id="roomActionButton" class="mt-2">
              ${room_id 
                ? `<button class="btn btn-outline-danger btn-sm w-100" onclick="removeRoomFromValve('${valveId}')">Rimuovi</button>` 
                : `<button class="btn btn-outline-success btn-sm w-100" onclick="assignRoomSettings('${valveId}')">Assegna</button>`}
            </div>
          </div>
        </article>

        <!-- Override Manuale -->
        <article class="rooms-card" style="flex: 2; min-width: 300px;">
          <div class="settings-card">
            <h5>Override Manuale</h5>
            <p class="small text-muted mb-2">${activeOverride ? `Attivo: scade tra ${activeOverride.remainingSeconds}s` : "Nessun override attivo"}</p>
            <div class="d-flex gap-2">
              <select id="overrideState" class="form-select form-select-sm">
                <option value="true">ON</option>
                <option value="false">OFF</option>
              </select>
              <input id="overrideDuration" type="number" class="form-control form-control-sm" placeholder="Secondi" value="60">
              <button class="btn btn-warning btn-sm" onclick="activateOverride('${valveId}')">Attiva</button>
            </div>
            ${activeOverride ? `<button class="btn btn-danger btn-sm w-100 mt-2" onclick="cancelOverrideSettings('${valveId}')">Cancella Override</button>` : ""}
          </div>
        </article>

      </div>
    </div>
  `;
}

// --- LOGICA AZIONI ---

function selectValveForSettings() {
  const valveId = document.getElementById("settingsValveSelect").value;
  if (!valveId) return;
  window.selectedValve = valveId;
  localStorage.setItem("settingsSelectedValve", valveId);
  renderSettingsPage();
}

async function updateSetpoint(valveId) {
  const val = Number(document.getElementById("newSetpoint").value);
  await fetchJson("/setpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valveId, setpoint: val })
  });
  renderSettingsPage();
}

async function assignRoomSettings(valveId) {
  const roomId = document.getElementById("roomSelect").value;
  await fetchJson(`/valves/${valveId}/room`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
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
    container.innerHTML = `<button class="btn btn-outline-danger btn-sm w-100" onclick="removeRoomFromValve('${valveId}')">Rimuovi</button>`;
  } else {
    container.innerHTML = `<button class="btn btn-outline-success btn-sm w-100" onclick="assignRoomSettings('${valveId}')">Assegna</button>`;
  }
}

async function activateOverride(valveId) {
  const state = document.getElementById("overrideState").value === "true";
  const duration = Number(document.getElementById("overrideDuration").value);
  await fetchJson("/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valveId, state, duration })
  });
  renderSettingsPage();
}

async function cancelOverrideSettings(valveId) {
  await fetchJson(`/override/${valveId}`, { method: "DELETE" });
  renderSettingsPage();
}

async function deleteSelectedValve() {
  const valveId = document.getElementById("settingsValveSelect").value;
  if (!valveId || !confirm(`Eliminare definitivamente ${valveId}?`)) return;
  try {
    await fetch(`/valves/${valveId}`, { method: "DELETE" });
    await fetch(`http://localhost:8081/valve-${valveId}/actions/delete`, { method: "POST" });
    window.selectedValve = null;
    localStorage.removeItem("settingsSelectedValve");
    renderSettingsPage();
  } catch (err) {
    console.error("Errore eliminazione:", err);
  }
}
