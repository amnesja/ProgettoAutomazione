let valves = [];
let currentFilter = "";   // mantiene il filtro attivo anche dopo refresh

function initDashboard() {
  loadValves();

  // Quando l’utente scrive, aggiorniamo il filtro e ridisegniamo la tabella
  document.getElementById("searchInput").addEventListener("input", function () {
    currentFilter = this.value.toLowerCase();
    renderTable();
  });

  // Aggiorna i dati ogni 3 secondi SENZA perdere il filtro
  setInterval(loadValves, 3000);
}

async function loadValves() {
  const baseUrl = "http://localhost:8081";

  try {
    // 1️⃣ Otteniamo la lista delle valvole dal Directory Thing WoT
    //    ATTENZIONE: l’endpoint corretto è /valvedirectory (tutto minuscolo)
    const listRes = await fetch(`${baseUrl}/valvedirectory/properties/valves`);
    const valveIds = await listRes.json(); // esempio: ["valve1","valve2"]

    // 2️⃣ Per ogni valvola leggiamo le proprietà WoT
    const promises = valveIds.map(async (id) => {
      // Node-WoT espone il Thing come /valve-valve1, /valve-valve2, ecc.
      const thingName = `valve-${id}`;

      const [tempRes, heatRes] = await Promise.all([
        fetch(`${baseUrl}/${thingName}/properties/temperature`),
        fetch(`${baseUrl}/${thingName}/properties/heating`)
      ]);

      const temperature = await tempRes.json();
      const heating = await heatRes.json();

      return {
        id, // id logico: "valve1"
        thingName, // nome WoT: "valve-valve1"
        temperature: Number(temperature),
        heating: Boolean(heating),

        // placeholder finché non aggiungiamo queste proprietà al WoT
        setpoint: 20,
        last_seen: new Date().toLocaleTimeString()
      };
    });

    valves = await Promise.all(promises);

    renderTable();

  } catch (err) {
    console.error("Errore WoT:", err);
  }
}

function renderTable() {
  const tbody = document.getElementById("valvesBody");
  tbody.innerHTML = "";

  // Applica il filtro se presente
  let filtered = valves;

  if (currentFilter.trim() !== "") {
    filtered = valves.filter(v =>
      v.id.toLowerCase().includes(currentFilter)
    );
  }

  // Disegna la tabella
  filtered.forEach(v => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${v.id}</td>
      <td>${v.temperature.toFixed(1)}°C</td>
      <td>${v.setpoint}°C</td>
      <td>${v.heating ? "🔥 ON" : "❄️ OFF"}</td>
      <td>${v.last_seen}</td>
      <td>
        <button class="btn btn-sm btn-primary me-1" onclick="goToDetails('${v.id}')">Dettagli</button>
      </td>
    `;

    tbody.appendChild(row);
  });
}

function goToDetails(name) {
  window.location.hash = "details";
  window.selectedValve = name;
}

function goToSettings(name) {
  window.location.hash = "settings";
  window.selectedValve = name;
}
