# 🌡️ Progetto Automazione — Smart Thermostat

Applicazione Node.js/TypeScript per simulare e controllare un sistema di riscaldamento con **valvole smart**, **MQTT**, **SQLite**, **API HTTP** e integrazione **Web of Things**.

Il progetto include:

- un **controller** che decide quando accendere o spegnere il riscaldamento
- un **simulatore** di valvole che invia temperature via MQTT
- una **API HTTP Express** per consultare e modificare dati persistiti
- una **persistenza dati** su SQLite
- una **dashboard web** statica servita dalla stessa app
- un'integrazione **node-wot** per leggere/esporre lo stato live delle valvole come Thing

Il frontend usa un approccio **ibrido**:

- **Express** per stanze, storico, setpoint, assegnazione valvole e operazioni CRUD
- **WoT** per lo stato live delle valvole, in particolare temperatura e heating

---

## Indice

- [Obiettivo del progetto](#obiettivo-del-progetto)
- [Tecnologie utilizzate](#tecnologie-utilizzate)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Struttura del progetto](#struttura-del-progetto)
- [Comandi disponibili](#comandi-disponibili)
- [Configurazione](#configurazione)
- [Architettura](#architettura)
- [Topic MQTT](#topic-mqtt)
- [API HTTP](#api-http)
- [Interfaccia web](#interfaccia-web)
- [Web of Things](#web-of-things)
- [Note utili](#note-utili)
- [Guida rapida](#guida-rapida)

---

## Obiettivo del progetto

Il sistema simula una rete di valvole termostatiche che:

1. inviano periodicamente la temperatura tramite MQTT
2. vengono lette da un controller centrale
3. ricevono comandi di riscaldamento ON/OFF
4. salvano i dati in un database locale
5. espongono i dati via API HTTP e interfaccia web

Il flusso principale è:

**Simulatore → MQTT → Controller → MQTT → Simulatore**

---

## Tecnologie utilizzate

- **Node.js** — Runtime JavaScript
- **TypeScript** — Linguaggio tipizzato
- **Express 5** — Framework HTTP
- **MQTT** — Protocollo di messaggistica
- **better-sqlite3** — Driver SQLite
- **SQLite** — Database locale
- **dotenv** — Variabili d'ambiente
- **Bootstrap 5** — UI framework
- **Chart.js** — Grafici
- **node-wot** — Web of Things (`@node-wot/core`, `@node-wot/binding-http`)

---

## Requisiti

Prima di eseguire il progetto servono:

- **Node.js** (versione 18+)
- **npm** (versione 9+)
- Un **broker MQTT** attivo (es. Mosquitto su `mqtt://localhost:1883`)
- Accesso alle porte:
  - `3001` per API/sito web
  - `8081` per WoT

---

## Installazione

1. Clona il repository:
```bash
git clone https://github.com/amnesja/ProgettoAutomazione.git
cd ProgettoAutomazione
```

2. Installa le dipendenze:
```bash
npm install
```

3. Configura le variabili d'ambiente (opzionale):
```bash
# Il file .env è già presente con i valori di default
# Modificalo secondo le tue esigenze
```

4. Avvia il broker MQTT (se non è già in esecuzione):
```bash
# Ubuntu/Debian
sudo apt install mosquitto mosquitto-clients
sudo systemctl start mosquitto

# macOS
brew install mosquitto
brew services start mosquitto

# Windows scarica Mosquitto da https://mosquitto.org/download/
```

---

## Struttura del progetto

```
ProgettoAutomazione/
├── .env                 # Variabili d'ambiente
├── package.json         # Dipendenze e script
├── tsconfig.json       # Configurazione TypeScript root
├── README.md          # Documentazione
├── backend/
│   ├── tsconfig.json # Configurazione TypeScript backend
│   ├── dist/        # File compilati (output build)
│   └── src/
│       ├── api/            # API HTTP
│       ├── config/         # Configurazione env
│       ├── controller/      # Logica di controllo
│       ├── db/             # Database SQLite
│       ├── mqtt/          # Client MQTT
│       ├── simulator/      # Simulatore valvola
│       ├── utils/          # Utility
│       ├── wot/           # Web of Things
│       └── tests/          # Test
├── frontend/               # Interfaccia web
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── pages/
└── scripts/               # Script di utilità
```

### File principali

| File | Descrizione |
|------|-------------|
| `backend/src/api/app.ts` | Definizione route REST |
| `backend/src/api/server.ts` | Server API + frontend static |
| `backend/src/api/server-api.ts` | Server API-only |
| `backend/src/controller/controller.ts` | Logica di controllo |
| `backend/src/simulator/valveSimulator.ts` | Simulatore valvola |
| `backend/src/db/database.ts` | Schema SQLite |
| `backend/src/db/repository.ts` | Funzioni accesso dati |
| `backend/src/wot/things.ts` | Esposizione WoT |

---

## Comandi disponibili

### Avvio API + sito web
```bash
npm run dev
```
Server su `http://localhost:3001` con dashboard statica.

### Avvio API-only
```bash
npm run dev:api
```
Server senza frontend static (solo API su `http://localhost:3001`).

### Avvio controller
```bash
npm run controller
```
Avvia la logica di controllo:
- ascolta le temperature via MQTT
- applica isteresi (±1°C)
- gestisce override manuali
- rileva valvole offline (30s senza dati)
- **ricalcola automaticamente il comando heating quando una valvola viene assegnata a una stanza**

> **Nota**: Il controller deve essere avviato separatamente. Non è integrato con `npm run wot`.

### Avvio simulatore
```bash
npm run simulator -- valve1
```
Avvia simulatore valvola (default: `valve1`).

### Avvio Web of Things
```bash
npm run wot
```
Esporta valvole come Thing WoT su `http://localhost:8081`.

### Build
```bash
npm run build
```
Compila TypeScript in `backend/dist/`.

### Produzione
```bash
npm run start
```
Avvia server compilato da `backend/dist/src/api/server.js` (dopo `npm run build`).

### Test
```bash
npm test           # Test automatici
npm run test:types  # Controllo tipi
```

---

## Configurazione

Le variabili d'ambiente si trovano nel file `.env` nella root del progetto.

### Variabili disponibili

| Variabile | Descrizione | Default |
|----------|-------------|---------|
| `MQTT_BROKER` | URL broker MQTT | `mqtt://localhost:1883` |
| `PORT` | Porta HTTP API | `3001` |
| `WOT_PORT` | Porta WoT | `8081` |
| `SQLITE_DB_PATH` | Percorso database | `thermostat.db` |
| `SERVE_FRONTEND` | Servi frontend static | `true` |
| `FRONTEND_DIR` | Directory frontend | `frontend` |

### Creare variabili personalizzate

Modifica il file `.env`:
```bash
# Esempio: usa database in memoria per i test
SQLITE_DB_PATH=":memory:"

# Esempio: cambia porta
PORT=3000
```

---

## Architettura

### 1. Simulatore valvole
`backend/src/simulator/valveSimulator.ts`

- Pubblica periodicamente la temperatura su MQTT
- Ascolta i comandi `home/valves/{id}/command`
- Modifica la temperatura in base allo stato `heating`

### 2. Controller
`backend/src/controller/controller.ts`

- Sottoscrive `home/valves/+/temperature`
- Applica logica con **isteresi** (evita accensioni/spegnimenti frequenti)
- Gestisce **override** manuali temporanei
- Aggiorna lo stato nel database
- Marca valvole **OFFLINE** se non riceve dati per 30 secondi

### 3. API HTTP
`backend/src/api/server.ts` / `backend/src/api/app.ts`

- `server.ts`: API + frontend statico
- `app.ts`: definizione route REST
- `server-api.ts`: solo API

### 4. Database
`backend/src/db/database.ts` + `backend/src/db/repository.ts`

- Persistenza SQLite
- Tabelle: `valves`, `rooms`, `temperature_readings`
- Query per stanze, valvole, storico, statistiche

### 5. Web of Things
`backend/src/wot/things.ts`

- Crea Thing per ogni valvola
- Legge stato via MQTT
- Espone proprietà e azioni HTTP

---

## Topic MQTT

### Temperatura valvola
```
home/valves/{id}/temperature
```
```json
{
  "temperature": "20.50",
  "heating": false
}
```

### Comando valvola
```
home/valves/{id}/command
```
```json
{
  "heating": true
}
```

---

## API HTTP

### Endpoint valvole

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/valves` | Lista tutte le valvole |
| GET | `/valves/:id/history` | Storico temperature |
| POST | `/setpoint` | Aggiorna setpoint |
| POST | `/override` | Attiva override |
| GET | `/overrides` | Lista override attivi |
| DELETE | `/override/:valveId` | Rimuovi override |
| DELETE | `/valves/:valveId` | Elimina valvola |
| DELETE | `/rooms/:roomId` | Elimina stanza |

#### Esempi

```bash
# Lista valvole
curl http://localhost:3001/valves

# Storico valvola
curl http://localhost:3001/valves/valve1/history

# Aggiorna setpoint
curl -X POST http://localhost:3001/setpoint \
  -H "Content-Type: application/json" \
  -d '{"valveId": "valve1", "setpoint": 21}'

# Attiva override
curl -X POST http://localhost:3001/override \
  -H "Content-Type: application/json" \
  -d '{"valveId": "valve1", "state": true, "duration": 60}'

# Elimina valvola
curl -X DELETE http://localhost:3001/valves/valve1
```

### Endpoint stanze

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/rooms` | Lista stanze |
| POST | `/rooms` | Crea stanza |
| GET | `/rooms/:id` | Dettagli stanza |
| PUT | `/rooms/:id/setpoint` | Aggiorna setpoint |
| GET | `/rooms/:id/valves` | Valvole nella stanza |
| PUT | `/valves/:valveId/room` | Assegna valvola |

#### Esempi

```bash
# Crea stanza
curl -X POST http://localhost:3001/rooms \
  -H "Content-Type: application/json" \
  -d '{"id": "room1", "name": "Soggiorno", "globalSetpoint": 21}'

# Aggiorna setpoint stanza
curl -X PUT http://localhost:3001/rooms/room1/setpoint \
  -H "Content-Type: application/json" \
  -d '{"setpoint": 22}'

# Elimina stanza
curl -X DELETE http://localhost:3001/rooms/room1
```

### Endpoint analytics

```bash
# Statistiche stanze
curl http://localhost:3001/analytics/rooms
```

---

## Interfaccia web

L'interfaccia è accessibile su `http://localhost:3001`.

### Pagine

- **Dashboard** — Vista generale del sistema
- **Dettagli** — Stato singole valvole
- **Stanze** — Gestione stanze e setpoint
- **Impostazioni** — Configurazione

### Fonti dati

- **Dashboard**: API Express + WoT per dati live
- **Dettagli**: API Express
- **Stanze**: API Express

### Librerie frontend

- Bootstrap 5
- Chart.js

---

## Web of Things

WoT espone le valvole come Thing accessibili su `http://localhost:8081`.

### Proprietà

- `temperature` — Temperatura attuale
- `heating` — Stato riscaldamento

### Azioni

- `setHeating` — Accendi/spegni riscaldamento

### Esempio interazione

```bash
# Leggi stato valvola
curl http://localhost:8081/valve1/properties

# Accendi riscaldamento
curl -X POST http://localhost:8081/valve1/actions/setHeating \
  -H "Content-Type: application/json" \
  -d '{"heating": true}'
```

---

## Note utili

- Database: `thermostat.db` (root del progetto)
- Valvole: pattern `valveN` (es. `valve1`, `valve2`)
- Isteresi: evitare accensioni/spegnimenti frequenti
- Offline: valvola senza dati per 30 secondi
- **Prima di eseguire `npm run start`, esegui `npm run build`**

---

## Guida rapida

Esegui i componenti in terminali separati:

1. **Broker MQTT** (se non è un servizio)
2. **Controller** — obbligatorio per funzionamento del sistema
3. **Simulatore** — per simulare temperature
4. **API** — per interfaccia web
5. **Browser**: `http://localhost:3001`

### Terminali separati

Il controller deve essere avviato manualmente in un terminale separato:

```bash
# Terminale 1: Controller (obbligatorio!)
npm run controller

# Terminale 2: Simulatore
npm run simulator -- valve1

# Terminale 3: API
npm run dev
```

> **Importante**: Se il controller non è in esecuzione, le valvole non riceveranno comandi di heating anche se il simulatore invia temperature.

### Verifica

```bash
# Testa l'API
curl http://localhost:3001/valves

# Testa WoT
curl http://localhost:8081/
```

---

## Risoluzione problemi

### "Cannot find module"

Esegui `npm install`.

### "Connection refused" (MQTT)

Verifica che Mosquitto sia in esecuzione:
```bash
mosquitto -v    # Versione
systemctl status mosquitto  # Stato servizio
```

### "Port already in use"

Cambia la porta in `.env`:
```bash
PORT=3002
```

### Errori TypeScript

Esegui controllo tipi:
```bash
npm run test:types
```


