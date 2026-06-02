// Assicuriamo l'esistenza dei timer sull'oggetto globale per evitare conflitti nella SPA
if (typeof window.settingsRefreshTimer === "undefined") window.settingsRefreshTimer = null;
if (typeof window.liveStatusTimer === "undefined") window.liveStatusTimer = null;

// LETTURA SICURA: Usa gli URL globalizzati per azzerare i crash di sintassi
var API_BASE = window.REST_API_URL || "http://localhost:3001";
var WOT_BASE = window.WOT_SERVER_URL || "http://localhost:8081";


//INIT EXPORT: Agganciato esplicitamente a window per il router

window.initSettings = async function() {
  if (window.settingsRefreshTimer) clearInterval(window.settingsRefreshTimer);
  if (window.liveStatusTimer) clearInterval(window.liveStatusTimer);

  await renderSettingsPage();

  window.settingsRefreshTimer = setInterval(renderSettingsPage, 20000);
  window.liveStatusTimer = setInterval(refreshLiveStatus, 3000);
};

// CONSUMER BIVIO: Proprietà fisiche dal WoT, metadati strutturali da Express
 
async function refreshLiveStatus() {
  const valveId = window.selectedValve;
  if (!valveId) return;

  try {
    // 1. CALL WOT THING (Diretta): Proprietà fisiche real-time prese dal simulatore WoT
    const temperature = await fetchJson(`${WOT_BASE}/valve-${valveId}/properties/temperature`);
    const heating = await fetchJson(`${WOT_BASE}/valve-${valveId}/properties/heating`);

    // 2. CALL REST API (Express): Stato amministrativo conservato nel DB
    const valvesDb = await fetchJson(`${API_BASE}/valves`);
    const valveDb = valvesDb.find(v => v.id == valveId || v.id == valveId.replace("valve-", ""));
    
    const last_seen = valveDb?.last_seen ?? "N/A";
    const setpoint = valveDb?.setpoint ?? 20;

    // Controllo esistenza se l'utente si è spostato nel frattempo
    const elTemp = document.getElementById("liveTemp");
    const elHeating = document.getElementById("liveHeating");
    const elLastSeen = document.getElementById("liveLastSeen");
    const elSetpoint = document.getElementById("liveSetpointDisplay");

    if (elTemp) elTemp.textContent = Number(temperature).toFixed(1);
    if (elHeating) elHeating.textContent = heating ? "🔥 ON" : "❄️ OFF";
    if (elLastSeen) elLastSeen.textContent = last_seen;
    if (elSetpoint) elSetpoint.textContent = setpoint;

  } catch (err) {
    console.warn("Errore refresh live status nei settings:", err);
  }
}

async function renderSettingsPage() {
  let valveId = window.selectedValve || localStorage.getItem("settingsSelectedValve");
  const container = document.getElementById("settingsContent");

  if (!container) return;

  let valves = [];
  try {
    // CALL WOT SERVER: Recupera l'elenco delle valvole registrate in rete
    const valveList = await fetchJson(`${WOT_BASE}/valvedirectory/properties/valves`);
    valves = Array.isArray(valveList) ? valveList : [];
  } catch (err) {
    console.error("Directory WoT non raggiungibile:", err);
  }

  if (valveId && !valves.includes(valveId)) {
    valveId = null;
    localStorage.removeItem("settingsSelectedValve");
    window.selectedValve = null;
  }

  const selectorHtml = `
    <article class="rooms-card" style="flex: 1; min-width: 250px; max-width: 350px;">
      <div class="settings-card">
        <h5>Seleziona Valvola</h5>
        <select id="settingsValveSelect" class="form-select">
          ${valves.length === 0 
            ? '<option value="">Nessuna valvola trovata</option>' 
            : valves.map(v => `<option value="${v}" ${v === valveId ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-primary btn-sm" onclick="selectValveForSettings()">Apri</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSelectedValve()">Elimina</button>
        </div>
      </div>
    </article>
  `;

  if (!valveId) {
    const titleEl = document.getElementById("settingsTitle");
    if (titleEl) titleEl.textContent = "Impostazioni Hardware";
    container.innerHTML = selectorHtml;
    return;
  }

  window.selectedValve = valveId;
  localStorage.setItem("settingsSelectedValve", valveId);

  try {
    // FETCH DIRETTI WOT PER TEMPERATURA E RISCALDAMENTO
    const temperature = await fetchJson(`${WOT_BASE}/valve-${valveId}/properties/temperature`);
    const heating = await fetchJson(`${WOT_BASE}/valve-${valveId}/properties/heating`);
    
    // CHIAMATA API REST PER METADATI DB
    const valvesDb = await fetchJson(`${API_BASE}/valves`);
    const valveDb = valvesDb.find(v => v.id == valveId || v.id == valveId.replace("valve-", ""));

    const setpoint = valveDb?.setpoint ?? 20;
    const room_id = valveDb?.room_id ?? "";
    const last_seen = valveDb?.last_seen ?? "N/A";
    
    const rooms = await fetchJson(`${API_BASE}/rooms`);
    const overrides = await fetchJson(`${API_BASE}/overrides`);
    const activeOverride = overrides && overrides.active ? overrides.active[valveId] : null;

    const titleEl = document.getElementById("settingsTitle");
    if (titleEl) titleEl.textContent = `Impostazioni Hardware: ${valveId}`;

    container.innerHTML = `
      <div class="d-flex flex-column gap-3">
        <div class="d-flex justify-content-between gap-3 flex-wrap">
          ${selectorHtml}
          <article class="rooms-card" style="flex: 2; min-width: 280px;">
            <div class="settings-card">
              <h5>Stato Attuale (WoT Live)</h5>
              <div class="d-flex gap-4 flex-wrap mt-2">
                <div><strong>Temp:</strong> <span id="liveTemp">${Number(temperature).toFixed(1)}</span>°C</div>
                <div><strong>Setpoint:</strong> <span id="liveSetpointDisplay">${setpoint}</span>°C</div>
                <div><span id="liveHeating">${heating ? "🔥 ON" : "❄️ OFF"}</span></div>
              </div>
              <p class="mb-0 mt-3 small"><strong>Stanza logica:</strong> ${room_id || "Nessuna"}</p>
              <p class="mb-0 text-muted small">Ultima attività DB: <span id="liveLastSeen">${last_seen}</span></p>
            </div>
          </article>
        </div>

        <div class="d-flex justify-content-between gap-3 flex-wrap">
          <article class="rooms-card" style="flex: 1; min-width: 220px;">
            <div class="settings-card">
              <h5>Modifica Setpoint</h5>
              <div class="d-flex gap-2 mt-2">
                <input id="newSetpoint" type="number" class="form-control form-control-sm" value="${setpoint}" step="0.5">
                <button class="btn btn-primary btn-sm" onclick="updateSetpoint('${valveId}')">Salva</button>
              </div>
            </div>
          </article>

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
  } catch (err) {
    console.error("Errore parziale dati valvola, mostro comunque il selettore:", err);
    container.innerHTML = `
      <div class="alert alert-warning py-2 mb-3">Impossibile recuperare i dati in tempo reale della valvola selezionata (Servizi offline).</div>
      <div class="d-flex flex-column gap-3">${selectorHtml}</div>
    `;
  }
}

function selectValveForSettings() {
  const selectEl = document.getElementById("settingsValveSelect");
  if (!selectEl) return;
  const valveId = selectEl.value;
  if (!valveId) return;
  window.selectedValve = valveId;
  localStorage.setItem("settingsSelectedValve", valveId);
  renderSettingsPage();
}


// CHIAMATA Action Wot (Salva il setpoint anche nel db)

async function updateSetpoint(valveId) {
  const inputEl = document.getElementById("newSetpoint");
  if (!inputEl) return;
  const val = Number(inputEl.value);

  // Invochiamo DIRETTAMENTE l'azione semantica del WoT
  await fetchJson(`${WOT_BASE}/valve-${valveId}/actions/setTargetTemperature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(val) // o il payload richiesto dall'action
  });
  renderSettingsPage();
}


// CHIAMATA REST API (Express): Associa stanza e valvola nel database

async function assignRoomSettings(valveId) {
  const selectEl = document.getElementById("roomSelect");
  if (!selectEl) return;
  const roomId = selectEl.value;
  await fetchJson(`${API_BASE}/valves/${valveId}/room`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId })
  });
  renderSettingsPage();
}


// CHIAMATA REST API (Express): Disassocia la stanza dalla valvola nel DB

async function removeRoomFromValve(valveId) {
  await fetchJson(`${API_BASE}/valves/${valveId}/room`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: null })
  });
  renderSettingsPage();
}

function updateRoomButton(valveId, currentRoomId) {
  const selectEl = document.getElementById("roomSelect");
  const container = document.getElementById("roomActionButton");
  if (!selectEl || !container) return;
  const selected = selectEl.value;
  if (selected === currentRoomId && selected !== "") {
    container.innerHTML = `<button class="btn btn-outline-danger btn-sm w-100" onclick="removeRoomFromValve('${valveId}')">Rimuovi</button>`;
  } else {
    container.innerHTML = `<button class="btn btn-outline-success btn-sm w-100" onclick="assignRoomSettings('${valveId}')">Assegna</button>`;
  }
}


// CHIAMATA REST API (Express): Forza un'attivazione temporanea via Express REST

async function activateOverride(valveId) {
  const stateEl = document.getElementById("overrideState");
  const durationEl = document.getElementById("overrideDuration");
  if (!stateEl || !durationEl) return;
  
  const state = stateEl.value === "true";
  const duration = Number(durationEl.value);
  await fetchJson(`${API_BASE}/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valveId, state, duration })
  });
  renderSettingsPage();
}


// CHIAMATA REST API (Express): Cancella l'override manuale attivo

async function cancelOverrideSettings(valveId) {
  await fetchJson(`${API_BASE}/override/${valveId}`, { method: "DELETE" });
  renderSettingsPage();
}


// CHIAMATA REST API (Express): Cancella definitivamente la valvola dai record

async function deleteSelectedValve() {
  const selectEl = document.getElementById("settingsValveSelect");
  if (!selectEl) return;
  const valveId = selectEl.value;
  if (!valveId || !confirm(`Sei sicuro di voler eliminare definitivamente la valvola ${valveId}? Verrà rimossa dal DB, dal Controller e la sua istanza nel WoT verrà distrutta.`)) return;
  
  try {
    await fetchJson(`${API_BASE}/valves/${valveId}`, { method: "DELETE" });
    window.selectedValve = null;
    localStorage.removeItem("settingsSelectedValve");
    renderSettingsPage();
  } catch (err) {
    console.error("Errore durante l'eliminazione coordinata:", err);
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}