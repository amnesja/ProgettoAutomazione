let valves = [];
let rooms = [];
let currentFilter = "";
let dashboardRefreshTimer;
let pendingRoomSelections = {};
let selectedHistoryValveId = "";
let historyChart;
let roomsChart;
let heatingChart;
let setpointGauge;

const VALID_VALVE_ID = /^valve\d+$/i;

async function initDashboard() {
  if (dashboardRefreshTimer) {
    clearInterval(dashboardRefreshTimer);
  }

  const searchInput = document.getElementById("searchInput");

  if (!searchInput) {
    throw new Error("dashboard search input not found");
  }

  searchInput.value = currentFilter;
  searchInput.oninput = function () {
    currentFilter = this.value.toLowerCase();
    renderTable();
  };

  bindDashboardThemeRefresh();

  await refreshDashboardData();
  dashboardRefreshTimer = setInterval(refreshDashboardData, 5000);
}

async function refreshDashboardData() {
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

async function loadDashboardRooms(issues) {
  try {
    const roomsData = await fetchJson("/rooms");
    rooms = Array.isArray(roomsData) ? roomsData : [];
  } catch (err) {
    rooms = [];
    issues.push("Stanze non disponibili");
    console.error("Errore caricamento stanze:", err);
  }
}

async function loadValves(issues) {
  const baseUrl = "http://localhost:8081";

  try {
    const dbValves = await fetchJson("/valves");
    const safeDbValves = Array.isArray(dbValves) ? dbValves.filter((valve) => VALID_VALVE_ID.test(valve.id)) : [];
    const dbValveMap = Object.fromEntries(safeDbValves.map((valve) => [valve.id, valve]));
    let valveIds = safeDbValves.map((valve) => valve.id);

    try {
      const wotValveIds = await fetchJson(`${baseUrl}/valvedirectory/properties/valves`);
      if (Array.isArray(wotValveIds) && wotValveIds.length > 0) {
        const validWotValveIds = wotValveIds.filter((id) => VALID_VALVE_ID.test(id));
        valveIds = Array.from(new Set([...validWotValveIds, ...valveIds]));
      }
    } catch (err) {
      issues.push("WoT non disponibile");
      console.warn("Directory WoT non disponibile, uso i dati del DB.", err);
    }

    valves = await Promise.all(
      valveIds.map(async (id) => {
        const dbValve = dbValveMap[id] || {};
        const liveState = await loadValveLiveState(baseUrl, id);

        return {
          id,
          temperature: liveState.temperature ?? numberOrFallback(dbValve.temperature, 0),
          heating: liveState.heating ?? Boolean(dbValve.heating),
          setpoint: numberOrFallback(dbValve.setpoint, 20),
          last_seen: dbValve.last_seen || new Date().toLocaleTimeString(),
          room_id: pendingRoomSelections[id] ?? dbValve.room_id ?? ""
        };
      })
    );
  } catch (err) {
    valves = [];
    issues.push("Valvole non disponibili");
    console.error("Errore caricamento valvole:", err);
  }
}

async function loadValveLiveState(baseUrl, valveId) {
  const thingName = `valve-${valveId}`;

  try {
    const [tempRes, heatRes] = await Promise.all([
      fetch(`${baseUrl}/${encodeURIComponent(thingName)}/properties/temperature`),
      fetch(`${baseUrl}/${encodeURIComponent(thingName)}/properties/heating`)
    ]);

    if (!tempRes.ok || !heatRes.ok) {
      return {};
    }

    return {
      temperature: Number(await tempRes.json()),
      heating: Boolean(await heatRes.json())
    };
  } catch (err) {
    console.warn(`Thing WoT non disponibile per ${valveId}.`, err);
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
  if (!container) {
    throw new Error("dashboard metrics container not found");
  }

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
  if (!container) {
    throw new Error("dashboard spotlight container not found");
  }

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
  if (!select) {
    throw new Error("history valve select not found");
  }

  select.innerHTML = valves.map((valve) => `
    <option value="${valve.id}" ${valve.id === selectedHistoryValveId ? "selected" : ""}>${valve.id}</option>
  `).join("");

  select.onchange = async function () {
    selectedHistoryValveId = this.value;
    await renderCharts();
  };
}

async function renderCharts() {
  await Promise.all([
    renderHistoryChart(),
    renderRoomsChart(),
    renderHeatingChart(),
    renderSetpointGauge()
  ]);
}

async function renderHistoryChart() {
  const canvas = document.getElementById("historyChart");
  if (!canvas) {
    throw new Error("history chart canvas not found");
  }

  const history = selectedHistoryValveId
    ? await fetchJson(`/valves/${selectedHistoryValveId}/history`)
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
  if (!canvas) {
    throw new Error("rooms chart canvas not found");
  }

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
  if (!canvas) {
    throw new Error("heating chart canvas not found");
  }

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
  if (!canvas) {
    throw new Error("setpoint gauge canvas not found");
  }

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
        const meta = chart.getDatasetMeta(0);
        if (!meta?.data?.length) {
          return;
        }

        ctx.save();
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--dash-text");
        ctx.font = "700 22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${temperature.toFixed(1)}°C`, chart.width / 2, chart.height / 1.28);
        ctx.font = "500 13px sans-serif";
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--dash-muted");
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
    animation: {
      duration: 600
    },
    plugins: {
      legend: {
        labels: {
          color: textColor
        }
      },
      tooltip: {
        mode: type === "line" ? "index" : "nearest",
        intersect: false
      }
    },
    scales: type === "doughnut" ? undefined : {
      x: {
        ticks: {
          color: mutedColor
        },
        grid: {
          color: gridColor
        }
      },
      y: {
        ticks: {
          color: mutedColor
        },
        grid: {
          color: gridColor
        }
      }
    }
  };
}

function renderTable() {
  const tbody = document.getElementById("valvesBody");
  if (!tbody) {
    throw new Error("dashboard table body not found");
  }
  tbody.innerHTML = "";

  let filtered = valves;

  if (currentFilter.trim() !== "") {
    filtered = valves.filter((valve) => valve.id.toLowerCase().includes(currentFilter));
  }

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td colspan="7" class="text-center text-muted py-4">
        Nessuna valvola disponibile.
      </td>
    `;
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
        <button class="btn btn-sm btn-primary me-1" onclick="goToDetails('${valve.id}')">Dettagli</button>
        <button class="btn btn-sm btn-success" onclick="assignValveRoom('${valve.id}')">Assegna</button>
        <div class="small text-muted mt-1">${roomName}</div>
      </td>
    `;

    tbody.appendChild(row);
  });
}

function buildRoomControls(valve) {
  const selectedRoomId = pendingRoomSelections[valve.id] ?? valve.room_id ?? "";
  const options = ['<option value="">Nessuna</option>']
    .concat(
      rooms.map((room) => {
        const selected = room.id === selectedRoomId ? "selected" : "";
        return `<option value="${room.id}" ${selected}>${room.name}</option>`;
      })
    )
    .join("");

  return `
    <select
      class="form-select form-select-sm"
      id="room-select-${valve.id}"
      data-role="room-select"
      onchange="setPendingRoomSelection('${valve.id}', this.value)"
    >
      ${options}
    </select>
  `;
}

function formatLastSeen(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("it-IT");
}

function numberOrFallback(value, fallback) {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

async function assignValveRoom(valveId) {
  const select = document.getElementById(`room-select-${valveId}`);
  const roomId = select.value;

  try {
    const result = await fetchJson(`/valves/${valveId}/room`, {
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

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }

  return res.json();
}

function renderDashboardStatus(messages, type = "warning") {
  const container = document.getElementById("dashboardMessage");
  if (!container) {
    throw new Error("dashboard message container not found");
  }

  if (!messages || messages.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="alert alert-${type} py-2 mb-0" role="alert">
      ${messages.join(" | ")}
    </div>
  `;
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
  if (window.__dashboardThemeRefreshBound) {
    return;
  }

  document.addEventListener("themechange", () => {
    if (window.location.hash.replace("#", "") === "dashboard" || window.location.hash === "") {
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
