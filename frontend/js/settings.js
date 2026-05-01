let settingsRefreshTimer = null;
let settingsChart = null;

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

  // Se nessuna valvola selezionata, mostra solo il selettore compatto
  if (!valveId) {
    container.innerHTML = `
      <article class="rooms-card" style="max-width: 400px;">
        <div class="settings-card">
          <h4>Seleziona una valvola</h4>
          <select id="settingsValveSelect" class="form-select" onchange="selectValveForSettings()">
            <option value="">-- Scegli --</option>
            ${valves.map(v => `<option value="${v}">${v}</option>`).join("")}
          </select>
          <button class="btn btn-danger mt-3" onclick="deleteSelectedValve()">Elimina valvola</button>
        </div>
      </article>
    `;
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

  document.getElementById("settingsTitle").textContent = `Impostazioni: ${valveId}`;

  // Render chart
  await renderSettingsChart(valveId, valveDb);

  // Layout migliorato: selettore compatto + stato + 3 sezioni organizzate
  container.innerHTML = `
    <div class="d-flex flex-column gap-3">

      <!-- Riga 1: Selettore compatto + Stato -->
      <div class="d-flex justify-content-between gap-3 flex-wrap">
        <article class="rooms-card" style="flex: 1; min-width: 250px; max-width: 300px;">
          <div class="settings-card">
            <h5>Valvola</h5>
            <select id="settingsValveSelect" class="form-select" onchange="selectValveForSettings()">
              ${valves.map(v => `<option value="${v}" ${v === valveId ? "selected" : ""}>${v}</option>`).join("")}
            </select>
            <button class="btn btn-danger btn-sm mt-2" onclick="deleteSelectedValve()">Elimina</button>
          </div>
        </article>

        <article class="rooms-card" style="flex: 2; min-width: 280px;">
          <div class="settings-card">
            <h5>Stato attuale</h5>
            <div class="d-flex gap-3 flex-wrap">
              <div><strong>Temp:</strong> <span id="liveTemp">${Number(temperature).toFixed(1)}</span>°C</div>
              <div><strong>Target:</strong> ${setpoint}°C</div>
              <div><span id="liveHeating">${heating ? "🔥 ON" : "❄️ OFF"}</span></div>
            </div>
            <p class="mb-0 mt-2"><strong>Stanza:</strong> ${room_id || "Nessuna"}</p>
            <p class="mb-0 text-muted small">Ultima lettura: <span id="liveLastSeen">${last_seen}</span></p>
          </div>
        </article>
      </div>

      <!-- Riga 2: 3 Sezioni organizzate -->
      <div class="d-flex justify-content-between gap-3 flex-wrap">

        <!-- Sezione 1: Setpoint -->
        <article class="rooms-card" style="flex: 1; min-width: 200px;">
          <div class="settings-card">
            <h5>Setpoint</h5>
            <div class="d-flex gap-2 align-items-center">
              <input id="newSetpoint" type="number" class="form-control" style="width: 80px;" value="${setpoint}" step="0.5">
              <span>°C</span>
              <button class="btn btn-primary btn-sm" onclick="updateSetpoint('${valveId}')">Salva</button>
            </div>
          </div>
        </article>

        <!-- Sezione 2: Stanza -->
        <article class="rooms-card" style="flex: 1; min-width: 200px;">
          <div class="settings-card">
            <h5>Stanza</h5>
            <select id="roomSelect" class="form-select" onchange="updateRoomButton('${valveId}', '${room_id}')">
              <option value="">Nessuna</option>
              ${rooms.map(r => `<option value="${r.id}" ${r.id === room_id ? "selected" : ""}>${r.name}</option>`).join("")}
            </select>
            <div id="roomActionButton" class="mt-2">
              ${room_id 
                ? `<button class="btn btn-danger btn-sm" onclick="removeRoomFromValve('${valveId}')">Rimuovi</button>`
                : `<button class="btn btn-success btn-sm" onclick="assignRoomSettings('${valveId}')">Assegna</button>`
              }
            </div>
          </div>
        </article>

        <!-- Sezione 3: Override -->
        <article class="rooms-card" style="flex: 1; min-width: 220px;">
          <div class="settings-card">
            <h5>Override</h5>
            <p class="small mb-2">Stato: ${activeOverride ? `Attivo (${activeOverride.remainingSeconds}s)` : "Nessuno"}</p>
            <div class="d-flex gap-2">
              <select id="overrideState" class="form-select form-select-sm" style="width: 70px;">
                <option value="true">ON</option>
                <option value="false">OFF</option>
              </select>
              <input id="overrideDuration" type="number" class="form-control form-select-sm" style="width: 70px;" value="60" placeholder="sec">
            </div>
            <div class="d-flex gap-2 mt-2">
              <button class="btn btn-warning btn-sm" onclick="activateOverride('${valveId}')">Attiva</button>
              ${activeOverride ? `<button class="btn btn-danger btn-sm" onclick="cancelOverrideSettings('${valveId}')">Ferma</button>` : ""}
            </div>
          </div>
        </article>

      </div>
    </div>
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

// CHART FUNCTIONS

async function renderSettingsChart(valveId, valveDb) {
  const chartWrap = document.getElementById("settingsChartWrap");
  const canvas = document.getElementById("settingsChart");
  if (!chartWrap || !canvas) return;

  if (!valveId) {
    chartWrap.style.display = "none";
    return;
  }

  chartWrap.style.display = "block";

  const history = await fetchJson(`/valves/${valveId}/history`);
  const entries = Array.isArray(history) ? [...history].reverse().slice(-20) : [];

  if (entries.length === 0) {
    chartWrap.style.display = "none";
    return;
  }

  const labels = entries.map((entry) => new Date(entry.timestamp).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  }));
  const temperatures = entries.map((entry) => entry.temperature ?? 0);
  const setpointLine = entries.map(() => valveDb?.setpoint ?? 20);

  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue("--dash-text").trim() || "#172033";
  const mutedColor = styles.getPropertyValue("--dash-muted").trim() || "#64708a";
  const gridColor = styles.getPropertyValue("--dash-border").trim() || "rgba(25, 34, 52, 0.08)";

  settingsChart?.destroy();
  settingsChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Temperatura",
          data: temperatures,
          borderColor: "#ff7a59",
          backgroundColor: "rgba(255, 122, 89, 0.18)",
          fill: true,
          tension: 0.35,
          pointRadius: 2
        },
        {
          label: "Setpoint",
          data: setpointLine,
          borderColor: "#2f7bf6",
          borderDash: [6, 6],
          pointRadius: 0,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: textColor }
        }
      },
      scales: {
        x: {
          ticks: { color: mutedColor },
          grid: { color: gridColor }
        },
        y: {
          ticks: { color: mutedColor },
          grid: { color: gridColor }
        }
      }
    }
  });
}
