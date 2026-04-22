async function fetchValves() {
  const res = await fetch("/valves");
  return res.json();
}

async function fetchHistory(valveId) {
  const res = await fetch(`/valves/${valveId}/history`);
  return res.json();
}

async function fetchOverrides() {
  const res = await fetch("/overrides");
  return res.json();
}

function formatLastSeen(isoString) {
  if (!isoString) return "N/A";
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h fa`;
}

async function renderValves() {
  const valves = await fetchValves();
  const container = document.querySelector("#valves-container");
  const select = document.querySelector("#valve-select");
  const overrideSelect = document.querySelector("#override-valve");

  container.innerHTML = "";
  select.innerHTML = "";
  overrideSelect.innerHTML = "";

  valves.forEach((v) => {
    // Scheda della valvola
    const card = document.createElement("div");
    card.className = "valve-card";
    const statusClass = v.status === "ONLINE" ? "status-online" : "status-offline";
    const heatingClass = v.heating ? "heating-on" : "heating-off";
    
    card.innerHTML = `
      <h3>${v.id}</h3>
      <div class="valve-info">
        <div class="info-item">
          <div class="info-label">Status</div>
          <div class="${statusClass}">${v.status || "OFFLINE"}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Temperatura</div>
          <div>${v.temperature ? v.temperature.toFixed(1) + "°C" : "N/A"}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Setpoint</div>
          <div>${v.setpoint}°C</div>
        </div>
        <div class="info-item">
          <div class="info-label">Heating</div>
          <div class="${heatingClass}">${v.heating ? "ON" : "OFF"}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Ultimo dato</div>
          <div>${formatLastSeen(v.last_seen)}</div>
        </div>
      </div>
    `;
    container.appendChild(card);

    // Select per history e override
    const option = document.createElement("option");
    option.value = v.id;
    option.textContent = v.id;
    select.appendChild(option);
    
    const overrideOption = document.createElement("option");
    overrideOption.value = v.id;
    overrideOption.textContent = v.id;
    overrideSelect.appendChild(overrideOption);
  });

  if (valves.length > 0) {
    renderChart(valves[0].id);
  }
  
  // Aggiorna override attivi
  renderActiveOverrides();
}

async function renderActiveOverrides() {
  const overridesData = await fetchOverrides();
  const container = document.querySelector("#active-overrides");
  
  if (overridesData.count === 0) {
    container.innerHTML = "<p style='color: #6c757d;'>Nessun override attivo</p>";
    return;
  }
  
  let html = "<div style='margin-top: 15px;'><strong>Override attivi:</strong><br/>";
  for (const [valveId, data] of Object.entries(overridesData.active)) {
    const state = data.state ? "ON" : "OFF";
    html += `
      <div class="override-section">
        <div>${valveId}: <strong>${state}</strong> (${data.remainingSeconds}s rimasti)</div>
        <button class="danger" style="margin: 10px 0;" onclick="cancelOverride('${valveId}')">Cancella Override</button>
      </div>
    `;
  }
  html += "</div>";
  container.innerHTML = html;
}

async function activateOverride() {
  const valveId = document.querySelector("#override-valve").value;
  const state = document.querySelector("#override-state").value === "true";
  const duration = parseInt(document.querySelector("#override-duration").value);
  
  if (!valveId || !duration || duration <= 0) {
    alert("Seleziona una valvola e una durata valida");
    return;
  }
  
  try {
    const res = await fetch("/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valveId, state, duration })
    });
    
    const data = await res.json();
    if (res.ok) {
      alert(`Override attivato: ${valveId} = ${state ? "ON" : "OFF"} per ${duration}s`);
      renderValves();
    } else {
      alert(`Errore: ${data.error}`);
    }
  } catch (err) {
    alert("Errore di connessione");
  }
}

async function cancelOverride(valveId) {
  try {
    const res = await fetch(`/override/${valveId}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) {
      alert(`Override cancellato per ${valveId}`);
      renderValves();
    } else {
      alert(`Errore: ${data.error}`);
    }
  } catch (err) {
    alert("Errore di connessione");
  }
}

let chart;

async function renderChart(valveId) {
  const history = await fetchHistory(valveId);
  const ctx = document.getElementById("temp-chart").getContext("2d");

  const labels = history.map((h) => h.timestamp).reverse();
  const temps = history.map((h) => h.temperature).reverse();

  if (chart) {
    chart.destroy();
  }

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temperatura ${valveId}`,
          data: temps,
          borderColor: "#007bff",
          backgroundColor: "rgba(0, 123, 255, 0.1)",
          fill: true,
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          labels: { font: { size: 12 } }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          title: { display: true, text: "Temperatura (°C)" }
        }
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await renderValves();

  const select = document.querySelector("#valve-select");
  select.addEventListener("change", () => {
    renderChart(select.value);
  });

  // refresh ogni 5s
  setInterval(renderValves, 5000);
});
