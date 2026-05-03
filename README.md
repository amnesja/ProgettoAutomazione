# 🌡️ Progetto Automazione — Smart Thermostat

Applicazione **Node.js/TypeScript** per simulare e controllare un sistema di riscaldamento con **valvole smart**, **MQTT**, **SQLite**, **API HTTP** e integrazione **Web of Things**.

## Il progetto include:

- un **controller** che decide quanto accendere o spegnere il riscaldamento
- un **simulatore** di valvole che invia temperature via MQTT
- una **API HTTP Express** per consultare e modificare dati persistiti
- una **persistenza dati** su SQLite
- una **dashboard web** statica servita dalla stessa app
- un'integrazione **node-wot** per leggere/esporre lo stato live delle valvole come Thing

Il frontend usa un approccio **ibrido**:
- **Express** per stanze, storico, setpoint, assegnazione valvole e operazioni CRUD
- **WoT** per lo stato live delle valvole, in particolare temperatura e heating

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

## Obiettivo del progetto

Il sistema simula una rete di valvole termostatiche che:

1. inviano periodicamente la temperatura tramite MQTT
2. vengono lette da un controller centrale
3. ricevono comandi di riscaldamento ON/OFF
4. salvano i dati in un database locale
5. espongono i dati via API HTTP e interfaccia web

**Flusso principale**:  
**Simulatore → MQTT → Controller → MQTT → Simulatore**

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

## Requisiti

- **Node.js** (v18+)
- **npm** (v9+)
- **Broker MQTT** attivo (es. Mosquitto su `mqtt://localhost:1883`)
- Porte libere: `3001` (API/web), `8081` (WoT)

## Installazione

1. Clona il repository:
   ```bash
   git clone https://github.com/amnesja/ProgettoAutomazione.git
   cd ProgettoAutomazione
   ```

2. Installa dipendenze:
   ```bash
   npm install
   ```

3. (Opzionale) Configura `.env` (default OK)

4. Avvia broker MQTT:
   ```bash
   # Ubuntu/Debian
   sudo apt install mosquitto mosquitto-clients
   sudo systemctl start mosquitto
   ```

## Struttura del progetto

```
ProgettoAutomazione/
├── .env                    # Variabili d'ambiente
├── package.json            # Dipendenze & scripts
├── tsconfig.json           # TS root
├── README.md              # Questa doc
├── thermostat.db           # DB SQLite
├── backend/
│   ├── tsconfig.json      # TS backend
│   └── src/
│       ├── api/           # Express API
│       │   ├── app.ts
│       │   ├── server.ts
│       │   └── server-api.ts
│       ├── config/        # Env config
│       ├── controller/    # Logica controllo
│       ├── db/            # SQLite schema/repo
│       ├── mqtt/          # MQTT client
│       ├── simulator/     # Valve sim
│       ├── utils/         # Logger etc.
│       ├── wot/           # WoT things
│       └── tests/         # Tests
├── frontend/               # Static UI
│   ├── index.html
│   ├── css/style.css
│   ├── js/*.js
│   └── pages/*.html
└── scripts/                # Utils
```

**File chiave**:
| File | Descrizione |
|------|-------------|
| `backend/src/api/server.ts` | Server API + static frontend |
| `backend/src/controller/controller.ts` | Logica controller |
| `backend/src/simulator/valveSimulator.ts` | Simulatore valvole |
| `backend/src/db/database.ts` | Schema DB |
| `backend/src/db/repository.ts` | DB access |
| `backend/src/wot/things.ts` | WoT exposure |

## Comandi disponibili

| Comando | Descrizione |
|---------|-------------|
| `npm run dev` | API + web (`tsx backend/src/api/server.ts`) |
| `npm run dev:api` | API only |
| `npm run controller` | Logica controllo MQTT |
| `npm run simulator -- valve1` | Simulatore valvola |
| `npm run wot` | Web of Things (`:8081`) |
| `npm run build` | Compila TS → `backend/dist/` |
| `npm run start` | Produzione (post-build) |
| `npm test` | Tests |

## Configurazione

File `.env` (root):

```
MQTT_BROKER=mqtt://localhost:1883
PORT=3001
WOT_PORT=8081
SQLITE_DB_PATH=thermostat.db
SERVE_FRONTEND=true
```

## Architettura

1. **Simulatore** (`valveSimulator.ts`): Pubbl. temp. MQTT, rx comandi
2. **Controller** (`controller.ts`): Isteresi (±1°C), overrides, offline detect, DB update
3. **API** (`server.ts/app.ts`): REST + static serve
4. **DB** (`database.ts/repository.ts`): Valves/rooms/readings
5. **WoT** (`things.ts`): Dynamic Things per valvola

## Topic MQTT

- **Temp**: `home/valves/{id}/temperature`  
  `{"temperature":20.5,"heating":false}`
- **Cmd**: `home/valves/{id}/command`  
  `{"heating":true}`

## API HTTP

**Base**: `http://localhost:3001`

### Valvole
| Method | Endpoint | Desc |
|--------|----------|------|
| GET | `/valves` | Lista |
| GET | `/valves/:id/history` | Storico |
| POST | `/setpoint` | Setpoint |
| POST | `/override` | Override |
| DELETE | `/override/:id` | Rimuovi override |

**Esempi**:
```bash
curl http://localhost:3001/valves
curl -X POST -H'Content-Type:application/json' -d'{\"valveId\":\"valve1\",\"setpoint\":21}' http://localhost:3001/setpoint
```

### Stanze
| Method | Endpoint | Desc |
|--------|----------|------|
| GET | `/rooms` | Lista |
| POST | `/rooms` | Crea |
| PUT | `/rooms/:id/setpoint` | Setpoint |
| PUT | `/valves/:id/room` | Assegna |

### Analytics
- GET `/analytics/rooms`

## Interfaccia web

Accessibile su `http://localhost:3001`

- **Dashboard**: Overview
- **Dettagli**: Valve status
- **Stanze**: Gestione
- **Impostazioni**: Config

**Librerie**: Bootstrap 5, Chart.js  
**Dati**: API Express + WoT live

## Web of Things

`http://localhost:8081/{valveId}`

**Props**: `temperature`, `heating`  
**Actions**: `setHeating`

```bash
curl http://localhost:8081/valve1/properties
```

## Note utili

- **DB**: `thermostat.db`
- **Valvole**: `valveN` pattern
- **Offline**: >30s no data
- **Prima di `npm run start`**: `npm run build`
- **Repo**: [GitHub](https://github.com/amnesja/ProgettoAutomazione)

## Guida rapida

**Terminali separati**:
```bash
# T1: Controller (obbligatorio)
npm run controller

# T2: Simulatore
npm run simulator -- valve1

# T3: API/Web
npm run dev
```

Apri: [http://localhost:3001](http://localhost:3001)

**Test**:
```bash
curl http://localhost:3001/valves
```
