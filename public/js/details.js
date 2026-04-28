let detailsRefreshTimer;
let detailsHistoryChart;

async function initDetails() {
  if (detailsRefreshTimer) {
    clearInterval(detailsRefreshTimer);
  }

  bindDetailsThemeRefresh();
  await refreshDetailsPage();
  detailsRefreshTimer = setInterval(refreshDetailsPage, 5000);
}

async function refreshDetailsPage() {
  try {
    const [valves, rooms] = await Promise.all([
      fetchJson("/valves"),
      fetchJson("/rooms")
    ]);

    const validValves = Array.isArray(valves) ? valves : [];
    const safeRooms = Array.isArray(rooms) ? rooms : [];
    const valveSelect = document.getElementById("detailsValveSelect");

    if (!valveSelect) {
      throw new Error("details valve select not found");
    }

    if (!validValves.length) {
      renderDetailsMessage("Nessuna valvola disponibile.", "warning");
      renderEmptyDetailsState();
      valveSelect.innerHTML = "";
      return;
    }

    const selectedValveStillExists = validValves.find((valve) => valve.id === window.selectedValve);
    if (!selectedValveStillExists) {
      window.selectedValve = validValves[0].id;
    }

    valveSelect.innerHTML = validValves.map((valve) => `
      <option value="${valve.id}" ${valve.id === window.selectedValve ? "selected" : ""}>${valve.id}</option>
    `).join("");

    valveSelect.onchange = async function () {
      window.selectedValve = this.value;
      await refreshDetailsPage();
    };

    const selectedValve = validValves.find((valve) => valve.id === window.selectedValve);
    if (!selectedValve) {
      throw new Error("selected valve not found");
    }

    const roomName = safeRooms.find((room) => room.id === selectedValve.room_id)?.name || "Senza stanza";
    const history = await fetchJson(`/valves/${selectedValve.id}/history`);

    renderDetailsSummary(selectedValve, roomName);
    renderDetailsStats(selectedValve, roomName, Array.isArray(history) ? history : []);
    renderDetailsHistoryChart(selectedValve, Array.isArray(history) ? history : []);
    renderDetailsMessage();
  } catch (err) {
    console.error("Errore caricamento dettagli:", err);
    renderDetailsMessage("Non sono riuscito a caricare i dettagli della valvola.", "danger");
    renderEmptyDetailsState();
  }
}

function renderDetailsSummary(valve, roomName) {
  const container = document.getElementById("detailsSummary");
  if (!container) {
    throw new Error("details summary not found");
  }

  const temperature = numberOrFallback(valve.temperature, 0).toFixed(1);
  const setpoint = numberOrFallback(valve.setpoint, 20).toFixed(1);
  const heatingLabel = valve.heating ? "Heating attivo" : "Heating fermo";
  const statusTone = valve.heating ? "details-status-on" : "details-status-off";

  container.innerHTML = `
    <div class="details-summary-card">
      <div class="details-summary-top">
        <div>
          <p class="dashboard-eyebrow">Valvola</p>
          <h3 class="details-valve-name">${valve.id}</h3>
        </div>
        <span class="details-status ${statusTone}">${heatingLabel}</span>
      </div>

      <div class="details-thermo-grid">
        <div class="details-thermo-box">
          <span class="details-box-label">Temperatura</span>
          <strong>${temperature}°C</strong>
        </div>
        <div class="details-thermo-box">
          <span class="details-box-label">Setpoint</span>
          <strong>${setpoint}°C</strong>
        </div>
      </div>

      <div class="details-summary-meta">
        <span class="dashboard-pill">Stanza: ${roomName}</span>
        <span class="dashboard-pill">Ultima lettura: ${formatDateTime(valve.last_seen)}</span>
      </div>
    </div>
  `;
}

function renderDetailsStats(valve, roomName, history) {
  const container = document.getElementById("detailsStats");
  if (!container) {
    throw new Error("details stats not found");
  }

  const delta = (numberOrFallback(valve.temperature, 0) - numberOrFallback(valve.setpoint, 20)).toFixed(1);
  const minTemp = history.length ? Math.min(...history.map((entry) => numberOrFallback(entry.temperature, 0))).toFixed(1) : "--";
  const maxTemp = history.length ? Math.max(...history.map((entry) => numberOrFallback(entry.temperature, 0))).toFixed(1) : "--";
  const readings = history.length;

  const stats = [
    { label: "Delta dal target", value: `${delta}°C`, note: "Temperatura attuale meno setpoint" },
    { label: "Min recente", value: minTemp === "--" ? "--" : `${minTemp}°C`, note: `${readings} letture considerate` },
    { label: "Max recente", value: maxTemp === "--" ? "--" : `${maxTemp}°C`, note: roomName },
    { label: "Stato logico", value: valve.heating ? "ON" : "OFF", note: valve.status || "n/d" }
  ];

  container.innerHTML = stats.map((stat) => `
    <article class="details-stat-card">
      <p class="rooms-metric-label">${stat.label}</p>
      <p class="rooms-metric-value">${stat.value}</p>
      <p class="rooms-metric-note">${stat.note}</p>
    </article>
  `).join("");
}

function renderDetailsHistoryChart(valve, history) {
  const canvas = document.getElementById("detailsHistoryChart");
  if (!canvas) {
    throw new Error("details history chart not found");
  }

  const entries = [...history].reverse();
  const labels = entries.map((entry) => new Date(entry.timestamp).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit"
  }));
  const temperatures = entries.map((entry) => numberOrFallback(entry.temperature, 0));
  const setpointLine = entries.map(() => numberOrFallback(valve.setpoint, 20));

  detailsHistoryChart?.destroy();
  detailsHistoryChart = new Chart(canvas, {
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
    options: buildDetailsChartOptions()
  });
}

function buildDetailsChartOptions() {
  const styles = getComputedStyle(document.body);
  const textColor = styles.getPropertyValue("--dash-text").trim() || "#172033";
  const mutedColor = styles.getPropertyValue("--dash-muted").trim() || "#64708a";
  const gridColor = styles.getPropertyValue("--dash-border").trim() || "rgba(25, 34, 52, 0.08)";

  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: textColor
        }
      }
    },
    scales: {
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

function renderDetailsMessage(message = "", type = "info") {
  const container = document.getElementById("detailsMessage");
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

function renderEmptyDetailsState() {
  const summary = document.getElementById("detailsSummary");
  const stats = document.getElementById("detailsStats");
  if (summary) {
    summary.innerHTML = `<div class="rooms-empty-state">Nessun dettaglio disponibile.</div>`;
  }
  if (stats) {
    stats.innerHTML = "";
  }
  detailsHistoryChart?.destroy();
}

function bindDetailsThemeRefresh() {
  if (window.__detailsThemeRefreshBound) {
    return;
  }

  document.addEventListener("themechange", () => {
    if (window.location.hash.replace("#", "") === "details") {
      refreshDetailsPage();
    }
  });

  window.__detailsThemeRefreshBound = true;
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

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("it-IT");
}
