async function fetchValves() {
  const res = await fetch("/valves");
  return res.json();
}

async function fetchHistory(valveId) {
  const res = await fetch(`/valves/${valveId}/history`);
  return res.json();
}

async function renderValves() {
  const valves = await fetchValves();
  const tbody = document.querySelector("#valves-table tbody");
  const select = document.querySelector("#valve-select");

  tbody.innerHTML = "";
  select.innerHTML = "";

  valves.forEach((v) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${v.id}</td>
      <td>${v.setpoint}</td>
      <td>${v.heating ? "ON" : "OFF"}</td>
    `;
    tbody.appendChild(tr);

    const option = document.createElement("option");
    option.value = v.id;
    option.textContent = v.id;
    select.appendChild(option);
  });

  if (valves.length > 0) {
    renderChart(valves[0].id);
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
          borderColor: "red",
          fill: false
        }
      ]
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await renderValves();

  const select = document.querySelector("#valve-select");
  select.addEventListener("change", () => {
    renderChart(select.value);
  });

  // refresh ogni 10s
  setInterval(renderValves, 10000);
});
