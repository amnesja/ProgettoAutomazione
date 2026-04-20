# 🌡️ Smart Thermostat — Guida all’Implementazione

Questa guida descrive passo-passo come implementare il progetto (step base per farlo funzionare)

---

## 🧭 Roadmap di sviluppo

Seguire rigorosamente questo ordine:

---

## 🔹 FASE 0 — Setup

### Obiettivo:
Preparare l’ambiente di sviluppo.

### Attività:
- Configurare Node.js + TypeScript
- Sistemare `package.json`
- Configurare `tsconfig.json`
- Creare file `.env`
- Avviare broker MQTT (es. Mosquitto su localhost:1883)

---

## 🔹 FASE 1 — MQTT

### Obiettivo:
Verificare la comunicazione MQTT.

### Attività:
- Creare `src/mqtt/mqttClient.ts`
- Connettersi al broker
- Sottoscriversi a un topic
- Pubblicare e ricevere messaggi

### Test:
- Pubblicare un messaggio e verificarne la ricezione

---

## 🔹 FASE 2 — Simulatore Valvole

### Obiettivo:
Simulare dispositivi IoT.

### File:
src/simulator/valveSimulator.ts

### Attività:
- Pubblicare temperatura periodicamente
- Sottoscriversi ai comandi

### Topic:
home/valves/{id}/temperature
home/valves/{id}/command

### Test:
- Verificare invio temperature
- Verificare ricezione comandi

---

## 🔹 FASE 3 — Controller

### Obiettivo:
Implementare la logica di controllo.

### File:
src/controller/controller.ts

### Attività:
- Ricevere temperature
- Decidere ON/OFF
- Pubblicare comandi

### Logica base:
se temperatura < 20 → ON
se temperatura ≥ 20 → OFF

### Test:
- Il simulatore reagisce ai comandi

---

## 🔹 FASE 4 — Isteresi

### Obiettivo:
Evitare commutazioni frequenti.

### Logica:
< 19 → ON
21 → OFF
Questo è solo un esempio.

---

## 🔹 FASE 5 — Multi-valvola

### Obiettivo:
Gestire più dispositivi.

### Attività:
- Supportare più ID valvole
- Gestire stato per ciascuna

---

## 🔹 FASE 6 — Database

### Obiettivo:
Persistenza dati.

### File:
src/db/database.ts
src/db/repository.ts

### Dati da salvare:
- Temperature
- Stato valvole
- Setpoint
- Override

---

## 🔹 FASE 7 — API Express

### Obiettivo:
Controllo via HTTP.

### File:
src/api/server.ts

### Endpoint:
- `GET /valves`
- `POST /setpoint`
- `POST /override`

---

## 🔹 FASE 8 — Dashboard

### Obiettivo:
Visualizzazione dati.

### File:
public/index.html

### Attività:
- Fetch API
- Visualizzazione temperature
- Grafici (Chart.js)

---

## 🔹 FASE 9 — Override Manuale

### Obiettivo:
Controllo utente.

### Attività:
- Attivare/disattivare riscaldamento manualmente
- Gestire durata override

---

## 🔹 FASE 10 — Offline Detection

### Obiettivo:
Gestire dispositivi offline.

### Logica:
- Se non arrivano dati → stato OFFLINE

---

## 🔹 FASE 11 — Web of Things (node-wot)

### Obiettivo:
Aggiungere un livello semantico IoT.

### File:
src/wot/things.ts

### Attività:
- Modellare valvole come Thing
- Proprietà:
  - temperature
  - heating
- Azioni:
  - setHeating

### Integrazione:
- MQTT → aggiorna proprietà WoT
- WoT → pubblica comandi MQTT

---

## 🔹 FASE 12 — Rifinitura Finale

### Obiettivo:
Preparazione alla consegna.

### Attività:
- Logging
- Pulizia codice
- Aggiornamento README
- Test completo del sistema

---

## 🎯 Milestone

### 🟢 Milestone 1
- Simulatore → Controller → Comandi funzionanti

### 🟡 Milestone 2
- Database + API

### 🔵 Milestone 3
- Dashboard

### 🟣 Milestone 4
- Integrazione node-wot

---

## ⚠️ Regole Importanti

- Non saltare le fasi
- Testare ogni componente prima di proseguire
- Separare logica, comunicazione e interfaccia
- Non implementare WoT all’inizio

---

## 📌 Nota

Il cuore del progetto è il flusso:
Simulatore → MQTT → Controller → MQTT → Simulatore