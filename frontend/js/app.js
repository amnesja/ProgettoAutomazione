const THEME_STORAGE_KEY = "spa-theme-preference";
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function getThemePreference() {
  return localStorage.getItem(THEME_STORAGE_KEY) || "system";
}

function resolveTheme(preference = getThemePreference()) {
  if (preference === "dark") {
    return "dark";
  }
  if (preference === "light") {
    return "light";
  }
  return systemThemeQuery.matches ? "dark" : "light";
}

function applyTheme(preference = getThemePreference()) {
  const resolvedTheme = resolveTheme(preference);
  document.body.classList.toggle("dashboard-dark", resolvedTheme === "dark");
  document.body.dataset.themePreference = preference;
  updateThemeButtons(preference, resolvedTheme);
  document.dispatchEvent(new CustomEvent("themechange", {
    detail: { preference, resolvedTheme }
  }));
}

function updateThemeButtons(preference, resolvedTheme) {
  const buttons = document.querySelectorAll("[data-theme-toggle]");
  buttons.forEach((button) => {
    const labels = {
      system: "Tema: Sistema",
      dark: "Tema: Scuro",
      light: "Tema: Chiaro"
    };
    button.textContent = labels[preference] || "Tema";
    button.setAttribute("title", `Tema risolto: ${resolvedTheme}. Click per cambiare modalita.`);
  });
}

function toggleThemePreference() {
  const sequence = ["system", "dark", "light"];
  const currentPreference = getThemePreference();
  const currentIndex = sequence.indexOf(currentPreference);
  const nextPreference = sequence[(currentIndex + 1) % sequence.length];
  localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
  applyTheme(nextPreference);
}

function bindThemeToggle(root = document) {
  if (!root) {
    return;
  }
  root.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.onclick = toggleThemePreference;
  });
}

function initThemeSystem() {
  applyTheme();
  bindThemeToggle();

  if (!window.__themeSystemBound) {
    systemThemeQuery.addEventListener("change", () => {
      if (getThemePreference() === "system") {
        applyTheme("system");
      }
    });
    window.__themeSystemBound = true;
  }
}

async function loadPage(page) {
  try {
    const res = await fetch(`/pages/${page}.html`);
    const html = await res.text();
    document.getElementById("app").innerHTML = html;
    bindThemeToggle(document.getElementById("app"));
    applyTheme();
    updatePageTitle(page);

    switch (page) {
      case "dashboard":
        if (typeof initDashboard !== "function") {
          throw new Error("initDashboard is not available");
        }
        await initDashboard();
        break;
      case "settings":
        await initSettings();
        break;
      case "rooms":
        await initRooms();
        break;
      case "wot":
        if (typeof initWot !== "function") {
          throw new Error("initWot is not available");
        }
        await initWot();
        break;
    }
  } catch (err) {
    console.error(`Errore caricando la pagina ${page}:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    document.getElementById("app").innerHTML = `
      <div class="alert alert-danger mt-4" role="alert">
        Errore caricando la pagina ${page}: ${errorMessage}
      </div>
    `;
  }
}

function updatePageTitle(page) {
  const titles = {
    dashboard: "Dashboard",
    rooms: "Stanze",
    wot: "WoT Explorer"
  };
  document.getElementById("pageTitle").textContent = titles[page] || "App";
}
function router() {
  const page = window.location.hash.replace("#", "") || "dashboard";
  loadPage(page);
}

initThemeSystem();
window.addEventListener("hashchange", router);
window.addEventListener("load", router);


// Fix: i link della sidebar devono triggerare il router
document.addEventListener("click", function (e) {
  if (e.target.matches(".nav-link")) {
    const hash = e.target.getAttribute("href");
    window.location.hash = hash;   // forza il cambio pagina
  }
});

// Search functionality
function initSearch() {
  const searchInput = document.getElementById("navSearch");
  if (!searchInput) return;

  searchInput.addEventListener("input", function (e) {
    const query = e.target.value.toLowerCase().trim();
    const event = new CustomEvent("search", { detail: { query } });
    document.dispatchEvent(event);
  });
}

// System status indicator
function updateSystemStatus(isOnline) {
  const statusEl = document.getElementById("systemStatus");
  if (!statusEl) return;

  const textEl = statusEl.querySelector(".app-status-text");
  if (isOnline) {
    statusEl.classList.remove("offline");
    if (textEl) textEl.textContent = "Online";
  } else {
    statusEl.classList.add("offline");
    if (textEl) textEl.textContent = "Offline";
  }
}

// Initialize on load
initSearch();

// Check API connectivity periodically
setInterval(async () => {
  try {
    const res = await fetch("/valves");
    updateSystemStatus(res.ok);
  } catch {
    updateSystemStatus(false);
  }
}, 10000);
