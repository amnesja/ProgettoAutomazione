async function loadPage(page) {
  const res = await fetch(`/pages/${page}.html`);
  const html = await res.text();
  document.getElementById("app").innerHTML = html;

  // Aggiorna titolo header
  updatePageTitle(page);

  // Inizializza logica pagina
  switch (page) {
    case "dashboard": initDashboard(); break;
    case "details": initDetails(); break;
    case "settings": initSettings(); break;
    case "wot": initWot(); break;
  }
}

function updatePageTitle(page) {
  const titles = {
    dashboard: "Dashboard",
    details: "Dettagli",
    settings: "Impostazioni",
    wot: "WoT Explorer"
  };

  document.getElementById("pageTitle").textContent = titles[page] || "App";
}

function router() {
  const page = window.location.hash.replace("#", "") || "dashboard";
  loadPage(page);
}

window.addEventListener("hashchange", router);
window.addEventListener("load", router);


// Fix: i link della sidebar devono triggerare il router
document.addEventListener("click", function (e) {
  if (e.target.matches(".nav-link")) {
    const hash = e.target.getAttribute("href");
    window.location.hash = hash;   // forza il cambio pagina
  }
});