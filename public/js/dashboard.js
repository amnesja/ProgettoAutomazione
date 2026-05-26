let valves = [];
let rooms = [];
let currentFilter = "";
let pendingRoomSelections = {};
let selectedHistoryValveId = "";
let historyChart;
let roomsChart;
let heatingChart;
let setpointGauge;

const VALID_VALVE_ID = /^valve\d+$/i;

// 🌟 LETTURA SICURA SENZA CONFLITTI: Recuperiamo gli endpoint globali definiti in app.js
var API_BASE = window.REST_API_URL || "http://localhost:3001";
var WOT_BASE = window.WOT_SERVER_URL || "http://localhost:8081";

async function initDashboard() {
  // Pulizia accurata del vecchio timer registrato sulla finestra globale
  if (window.dashboardRefreshTimer) {
    clearInterval(window.dashboardRefreshTimer);
  }

  const searchInput = document.getElementById("searchInput");
  if (!searchInput) return; // Uscita di sicurezza se non siamo sulla pagina corretta

  searchInput.value = currentFilter;
  searchInput.oninput = function () {
    currentFilter = this.value.toLowerCase();
    renderTable();
  };

  bindDashboardThemeRefresh();
  await refreshDashboardData();
  
  // Assegnazione del loop di aggiornamento all'oggetto globale window
  window.dashboardRefreshTimer = setInterval(refreshDashboardData, 5000);
}

async function refreshDashboardData() {
  // Se non c'è il container delle metriche, significa che l'utente ha cambiato pagina: fermiamo le chiamate
  if (!document.getElementById("dashboardMetrics")) return;

  const activeElement = document.activeElement;
  if (activeElement && activeElement.matches('select[data-role="room-select"]')) {
    return;
  }

  const issues = [];

  await Promise.all([
    loadDashboardRooms(issues),
    loadValves(issues)
  ]);

  ensureSelectedValve();
  renderMetrics();
  renderSpotlight();
  renderTable();
  renderHistoryValveSelect();
  await renderCharts();
  renderDashboardStatus(issues);
}

/**
 * 🏢 CALL REST API (Express): Recupera le stanze dal database locale
 */
async function loadDashboardRooms(issues) {
  try {
    const roomsData = await fetchJson(`${API_BASE}/rooms`);
    rooms = Array.isArray(roomsData) ? roomsData : [];
  } catch (err) {
    rooms = [];
    issues.push("Stanze non disponibili (Express DB Offline)");
    console.error("Errore caricamento stanze da Express:", err);
  }
}

/**
 * 📡 COMBINATO WOT DIRECTORY + REST API
 */
async function loadValves(issues) {
  try {
    let wotValveIds = [];
    try {
      // 📡 CALL WOT SERVER: Recupera l'elenco delle valvole attive direttamente dalla Directory del WoT
      wotValveIds = await fetchJson(`${WOT_BASE}/valvedirectory/properties/valves`);
      if (!Array.isArray(wotValveIds)) wotValveIds = [];
    } catch (err) {
      issues.push("Servizio WoT Server Offline");
      valves = [];
      return; 
    }

    const activeIds = wotValveIds.filter(id => VALID_VALVE_ID.test(id));
    if (activeIds.length === 0) {
      valves = []; 
      return;
    }

    // 🏢 CALL REST API (Express): Chiede lo stato strutturale registrato nel DB amministrativo
    const dbValves = await fetchJson(`${API_BASE}/valves`).catch(() => []);
    
    const onlineDbValveMap = Object.fromEntries(
      dbValves
        .filter(v => v.status === "ONLINE")
        .map(v => [v.id, v])
    );

    valves = await Promise.all(
      activeIds
        .filter(id => onlineDbValveMap[id])
        .map(async (id) => {
          const dbInfo = onlineDbValveMap[id];
          
          // 📡 CALL WOT THING (Diretta): Interroga l'istanza specifica della valvola sul WoT per i dati fisici al volo
          const liveState = await loadValveLiveState(id);

          return {
            id,
            temperature: liveState.temperature ?? numberOrFallback(dbInfo.temperature, 0),
            heating: liveState.heating ?? Boolean(dbInfo.heating),
            setpoint: liveState.setpoint ?? numberOrFallback(dbInfo.setpoint, 20),
            last_seen: dbInfo.last_seen || new Date().toLocaleTimeString(),
            room_id: pendingRoomSelections[id] ?? dbInfo.room_id ?? ""
          };
        })
    );

  } catch (err) {
    valves = [];
    issues.push("Errore nel caricamento dati integrati");
    console.error("Errore critico loadValves:", err);
  }
}

/**
 * 📡 CALL WOT THING (Diretta): Scarica le proprietà in tempo reale della Thing WoT
 */
async function loadValveLiveState(valveId) {
  const thingName = `valve-${valveId}`;
  try {
    const [tempRes, heatRes, setpointRes] = await Promise.all([
      fetch(`${WOT_BASE}/${encodeURIComponent(thingName)}/properties/temperature`),
      fetch(`${WOT_BASE}/${encodeURIComponent(thingName)}/properties/heating`),
      fetch(`${WOT_BASE}/${encodeURIComponent(thingName)}/properties/setpoint`).catch(() => null)
    ]);

    if (!tempRes.ok || !heatRes.ok) return {};

    return {
      temperature: Number(await tempRes.json()),
      heating: Boolean(await heatRes.json()),
      setpoint: setpointRes && setpointRes.ok ? Number(await setpointRes.json()) : null
    };
  } catch (err) {
    console.warn(`Thing WoT non raggiungibile per il real-time di ${valveId}.`, err);
    return {};
  }
}

function ensureSelectedValve() {
  if (!valves.length) {
    selectedHistoryValveId = "";
    return;
  }
  const found = valves.find((valve) => valve.id === selectedHistoryValveId);
  if (!found) {
    selectedHistoryValveId = valves[0].id;
  }
}

function renderMetrics() {
  const container = document.getElementById("dashboardMetrics");
  if (!container) return; // Sgancio di sicurezza per la SPA

  const onlineCount = valves.filter((valve) => valve.last_seen && valve.temperature > 0).length;
  const heatingCount = valves.filter((valve) => valve.heating).length;
  const avgTemp = valves.length
    ? (valves.reduce((sum, valve) => sum + valve.temperature, 0) / valves.length).toFixed(1)
    : "--";
  const assignedCount = valves.filter((valve) => valve.room_id).length;

  const metrics = [
    { label: "Valvole viste", value: valves.length, trend: `${assignedCount} assegnate a stanze` },
    { label: "Temperatura media", value: `${avgTemp}${avgTemp === "--" ? "" : "°C"}`, trend: `${rooms.length} stanze disponibili` },
    { label: "Heating ON", value: heatingCount, trend: `${Math.max(valves.length - heatingCount, 0)} in standby` },
    { label: "Valvole attive", value: onlineCount, trend: `${Math.max(valves.length - onlineCount, 0)} con dati non recenti` }
  ];

  container.innerHTML = metrics.map((metric) => `
    <article class="dashboard-metric">
      <p class="dashboard-metric-label">${metric.label}</p>
      <p class="dashboard-metric-value">${metric.value}</p>
      <p class="dashboard-metric-trend">${metric.trend}</p>
    </article>
  `).join("");
}

function renderSpotlight() {
  const container = document.getElementById("valveSpotlight");
  if (!container) return;

  if (!valves.length) {
    container.innerHTML = `
      <div class="dashboard-spotlight-card">
        <p class="dashboard-spotlight-copy">Nessuna valvola disponibile per il widget.</p>
      </div>
    `;
    return;
  }

  const spotlightValve = [...valves]
    .sort((a, b) => Math.abs(b.temperature - b.setpoint) - Math.abs(a.temperature - a.setpoint))[0];

  const roomName = rooms.find((room) => room.id === spotlightValve.room_id)?.name || "Senza stanza";
  const delta = (spotlightValve.temperature - spotlightValve.setpoint).toFixed(1);
  const mood = spotlightValve.heating ? "🔥" : "🌡️";

  container.innerHTML = `
    <div class="dashboard-spotlight-card">
      <h4 class="dashboard-spotlight-title">${mood} ${spotlightValve.id}</h4>
      <p class="dashboard-spotlight-copy">
        La valvola con lo scostamento piu marcato rispetto al setpoint.
      </p>
      <div class="dashboard-spotlight-stats">
        <span class="dashboard-pill">Stanza: ${roomName}</span>
        <span class="dashboard-pill">Temperatura: ${spotlightValve.temperature.toFixed(1)}°C</span>
        <span class="dashboard-pill">Target: ${spotlightValve.setpoint.toFixed(1)}°C</span>
        <span class="dashboard-pill">Delta: ${delta}°C</span>
      </div>
    </div>
  `;
}

function renderHistoryValveSelect() {
  const select = document.getElementById("historyValveSelect");
  if (!select) return;

  select.innerHTML = valves.map((valve) => `
    <option value="${valve.id}" ${valve.id === selectedHistoryValveId ? "selected" : ""}>${valve.id}</option>
  `).join("");

  select.onchange = async function () {
    selectedHistoryValveId = this.value;
    await renderCharts();
  };
}

async function renderCharts() {
  if (!document.getElementById("historyChart")) return; // Protezione se l'utente ha cambiato visualizzazione
  await Promise.all([
    renderHistoryChart(),
    renderRoomsChart(),
    renderHeatingChart(),
    renderSetpointGauge()
  ]);
}

/**
 * 🏢 CALL REST API (Express Storico): Interroga il database per l'estrazione cronologica
 */
async function renderHistoryChart() {
  const canvas = document.getElementById("historyChart");
  if (!canvas) return;

  const history = selectedHistoryValveId
    ? await fetchJson(`${API_BASE}/valves/${selectedHistoryValveId}/history`)
    : [];

  const entries = Array.isArray(history) ? [...history].reverse() : [];
  const labels = entries.map((entry) => new Date(entry.timestamp).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  }));
  const temperatures = entries.map((entry) => numberOrFallback(entry.temperature, 0));
  const currentValve = valves.find((valve) => valve.id === selectedHistoryValveId);
  const setpointLine = entries.map(() => currentValve?.setpoint ?? 20);

  historyChart?.destroy();
  historyChart = new Chart(canvas, {
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
    options: buildChartOptions("line")
  });
}

async function renderRoomsChart() {
  const canvas = document.getElementById("roomsChart");
  if (!canvas) return;

  const derivedAnalytics = rooms.map((room) => {
    const roomValves = valves.filter((valve) => valve.room_id === room.id);
    const avgTemperature = roomValves.length
      ? roomValves.reduce((sum, valve) => sum + valve.temperature, 0) / roomValves.length
      : 0;

    return {
      name: room.name,
      avgTemperature,
      globalSetpoint: numberOrFallback(room.global_setpoint, 20)
    };
  });

  const labels = derivedAnalytics.map((room) => room.name);
  const avgTemps = derivedAnalytics.map((room) => Number(room.avgTemperature.toFixed(2)));
  const setpoints = derivedAnalytics.map((room) => room.globalSetpoint);

  roomsChart?.destroy();
  roomsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Media temperatura",
          data: avgTemps,
          backgroundColor: "rgba(47, 123, 246, 0.78)",
          borderRadius: 6
        },
        {
          label: "Setpoint stanza",
          data: setpoints,
          type: "line",
          borderColor: "#ff7a59",
          backgroundColor: "#ff7a59",
          pointRadius: 3,
          tension: 0.3
        }
      ]
    },
    options: buildChartOptions("bar")
  });
}

async function renderHeatingChart() {
  const canvas = document.getElementById("heatingChart");
  if (!canvas) return;

  const heatingOn = valves.filter((valve) => valve.heating).length;
  const heatingOff = Math.max(valves.length - heatingOn, 0);

  heatingChart?.destroy();
  heatingChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Heating ON", "Heating OFF"],
      datasets: [{
        data: [heatingOn, heatingOff],
        backgroundColor: ["#ff7a59", "#2f7bf6"],
        borderWidth: 0
      }]
    },
    options: {
      ...buildChartOptions("doughnut"),
      cutout: "70%"
    }
  });
}

async function renderSetpointGauge() {
  const canvas = document.getElementById("setpointGauge");
  if (!canvas) return;

  const valve = valves.find((item) => item.id === selectedHistoryValveId);
  const temperature = valve?.temperature ?? 0;
  const setpoint = valve?.setpoint ?? 20;
  const progress = Math.min((temperature / Math.max(setpoint, 1)) * 100, 100);

  setpointGauge?.destroy();
  setpointGauge = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Temperatura attuale", "Spazio restante"],
      datasets: [{
        data: [progress, Math.max(100 - progress, 0)],
        backgroundColor: ["#18a46a", "rgba(100, 112, 138, 0.22)"],
        borderWidth: 0
      }]
    },
    options: {
      ...buildChartOptions("doughnut"),
      cutout: "78%",
      circumference: 180,
      rotation: 270
    },
    plugins: [{
      id: "gaugeLabel",
      afterDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--dash-text").trim() || "#172033";
        ctx.font = "700 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${temperature.toFixed(1)}°C`, chart.width / 2, chart.height / 1.28);
        ctx.font = "500 13px sans-serif";
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--dash-muted").trim() || "#64708a";
        ctx.fillText(`Target ${setpoint.toFixed(1)}°C`, chart.width / 2, chart.height / 1.12);
        ctx.restore();
      }
    }]
  });
}

function buildChartOptions(type) {
  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue("--dash-text").trim() || "#172033";
  const mutedColor = styles.getPropertyValue("--dash-muted").trim() || "#64708a";
  const gridColor = styles.getPropertyValue("--dash-border").trim() || "rgba(25, 34, 52, 0.08)";

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600 },
    plugins: {
      legend: { labels: { color: textColor } },
      tooltip: { mode: type === "line" ? "index" : "nearest", intersect: false }
    },
    scales: type === "doughnut" ? undefined : {
      x: { ticks: { color: mutedColor }, grid: { color: gridColor } },
      y: { ticks: { color: mutedColor }, grid: { color: gridColor } }
    }
  };
}

function renderTable() {
  const tbody = document.getElementById("valvesBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  let filtered = valves;
  if (currentFilter.trim() !== "") {
    filtered = valves.filter((valve) => valve.id.toLowerCase().includes(currentFilter));
  }

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="text-center text-muted py-4">Nessuna valvola disponibile.</td>`;
    tbody.appendChild(row);
    return;
  }

  filtered.forEach((valve) => {
    const row = document.createElement("tr");
    const roomName = rooms.find((room) => room.id === valve.room_id)?.name || "Nessuna";

    row.innerHTML = `
      <td>
        <button class="btn btn-link p-0 text-decoration-none" onclick="focusValve('${valve.id}')">
          ${valve.id}
        </button>
      </td>
      <td>${buildRoomControls(valve)}</td>
      <td>${valve.temperature.toFixed(1)}°C</td>
      <td>${valve.setpoint}°C</td>
      <td>${valve.heating ? "🔥 ON" : "❄️ OFF"}</td>
      <td>${formatLastSeen(valve.last_seen)}</td>
      <td>
        <button class="btn btn-sm btn-success" onclick="assignValveRoom('${valve.id}')">Assegna</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function buildRoomControls(valve) {
  const selectedRoomId = pendingRoomSelections[valve.id] ?? valve.room_id ?? "";
  const options = ['<option value="">Nessuna</option>']
    .concat(rooms.map((room) => `<option value="${room.id}" ${room.id === selectedRoomId ? "selected" : ""}>${room.name}</option>`))
    .join("");

  return `<select class="form-select form-select-sm" id="room-select-${valve.id}" data-role="room-select" onchange="setPendingRoomSelection('${valve.id}', this.value)">${options}</select>`;
}

function formatLastSeen(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("it-IT");
}

function numberOrFallback(value, fallback) {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

/**
 * 🏢 CALL REST API (Express Salva Relazione): Configura il link logico della valvola nel DB amministrativo
 */
async function assignValveRoom(valveId) {
  const select = document.getElementById(`room-select-${valveId}`);
  if (!select) return;
  const roomId = select.value;

  try {
    const result = await fetchJson(`${API_BASE}/valves/${valveId}/room`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId })
    });

    const valve = valves.find((item) => item.id === valveId);
    if (valve) {
      valve.room_id = roomId;
      valve.setpoint = numberOrFallback(result.setpoint, valve.setpoint);
    }
    pendingRoomSelections[valveId] = roomId;

    renderMetrics();
    renderSpotlight();
    renderTable();
    await renderCharts();
    const roomName = rooms.find((room) => room.id === roomId)?.name || "nessuna stanza";
    renderDashboardStatus([`Valvola ${valveId} assegnata a ${roomName}. Setpoint aggiornato a ${result.setpoint}°C.`], "success");
  } catch (err) {
    console.error("Errore assegnazione stanza:", err);
    renderDashboardStatus([`Non sono riuscito ad assegnare ${valveId} alla stanza selezionata.`], "danger");
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

function renderDashboardStatus(messages, type = "warning") {
  const container = document.getElementById("dashboardMessage");
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `<div class="alert alert-${type} py-2 mb-0" role="alert">${messages.join(" | ")}</div>`;
}

function focusValve(valveId) {
  selectedHistoryValveId = valveId;
  renderHistoryValveSelect();
  renderCharts();
}

function setPendingRoomSelection(valveId, roomId) {
  pendingRoomSelections[valveId] = roomId;
}

function bindDashboardThemeRefresh() {
  if (window.__dashboardThemeRefreshBound) return;
  document.addEventListener("themechange", () => {
    const currentHash = window.location.hash.replace("#", "");
    if (currentHash === "dashboard" || currentHash === "") {
      renderCharts();
    }
  });
  window.__dashboardThemeRefreshBound = true;
}

function goToDetails(name) {
  window.location.hash = "details";
  window.selectedValve = name;
}
function goToSettings(name) {
  window.location.hash = "settings";
  window.selectedValve = name;
}