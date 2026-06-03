# Progetto Automazione - Smart Thermostat WoT

Sistema di termoregolazione simulato basato su **Node.js**, **TypeScript**, **Web of Things**, **MQTT come trasporto WoT**, **Express** e **SQLite**.

Il progetto modella una rete di valvole termostatiche: ogni valvola simulata si registra in una directory WoT, invia telemetria periodica, riceve comandi di riscaldamento e mantiene sincronizzati stato live, database e interfaccia web.

## Indice

- [Panoramica](#panoramica)
- [Architettura](#architettura)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Configurazione](#configurazione)
- [Avvio locale](#avvio-locale)
- [Script npm](#script-npm)
- [Flusso dei dati](#flusso-dei-dati)
- [Topic MQTT](#topic-mqtt)
- [API REST](#api-rest)
- [Web of Things](#web-of-things)
- [Frontend](#frontend)
- [Database](#database)
- [Ontologia](#ontologia)
- [Struttura del progetto](#struttura-del-progetto)
- [Esempi rapidi](#esempi-rapidi)
- [Note tecniche](#note-tecniche)

## Panoramica

Il sistema è composto da quattro processi principali:

- **WoT Server** (`src/wot/things.ts`): espone una `ValveDirectory` e crea dinamicamente una Thing per ogni valvola registrata.
- **Simulatore valvola** (`src/simulator/valveSimulator.ts`): simula una valvola fisica, invoca action WoT via MQTT ogni 5 secondi e reagisce alle property change WoT ricevute via MQTT.
- **Controller** (`src/controller/controller.ts`): monitora le proprietà WoT via MQTT, applica la logica di isteresi, gestisce override manuali, aggiorna SQLite e invoca azioni WoT via HTTP.
- **API + Web UI** (`src/api/server.ts`): espone endpoint REST e serve la SPA statica in `public/`.

La logica di controllo usa:

- setpoint predefinito a `20°C`
- isteresi di `1°C`
- timeout offline di `30s`
- ID valvola validi nel formato `valveN`, ad esempio `valve1`, `valve2`

## Architettura

```text
Simulatore valvola
  -> invoca action WoT via MQTT: ValveDirectory/register
  -> invoca action WoT via MQTT: valve-{id}/updateStatus

WoT Server
  -> espone ValveDirectory
  -> espone valve-valve1, valve-valve2, ...
  -> pubblica property change via MQTT tramite node-wot
  -> espone properties/actions via HTTP/MQTT

Controller
  -> ascolta property change WoT via MQTT
  -> applica isteresi / override / offline timeout
  -> aggiorna SQLite
  -> invoca actions WoT via HTTP

Express API + Frontend
  -> legge e modifica dati amministrativi via SQLite
  -> serve dashboard, stanze e impostazioni
  -> la UI legge stato live direttamente dal WoT
```

## Requisiti

- Node.js
- npm
- broker MQTT attivo, ad esempio Mosquitto su `mqtt://localhost:1883`

Porte usate di default:

- `3001`: API Express e web app
- `8081`: server HTTP WoT
- `1883`: broker MQTT

## Installazione

```bash
npm install
```

## Configurazione

Il progetto usa `dotenv`. Puoi creare un file `.env` nella root:

```env
MQTT_BROKER=mqtt://localhost:1883
PORT=3001
WOT_PORT=8081
SQLITE_DB_PATH=thermostat.db
```

Valori di default se le variabili non sono definite:

- `MQTT_BROKER=mqtt://localhost:1883`
- `PORT=3001`
- `WOT_PORT=8081`
- `SQLITE_DB_PATH=thermostat.db`

Nota: nel frontend gli URL sono definiti in `public/js/app.js`:

```js
window.REST_API_URL = "http://localhost:3001";
window.WOT_SERVER_URL = "http://localhost:8081";
```

Se cambi porta all'API o al WoT server, aggiorna anche questi valori.

## Avvio locale

Avvia i componenti in terminali separati.

1. Avvia il broker MQTT.

```bash
mosquitto
```

2. Avvia il WoT server.

```bash
npm run wot
```

3. Avvia il controller.

```bash
npm run controller
```

4. Avvia una o più valvole simulate.

```bash
npm run simulator -- valve1
npm run simulator -- valve2
```

5. Avvia API e web app.

```bash
npm run dev
```

Poi apri:

```text
http://localhost:3001
```

## Script npm

| Script | Descrizione |
| --- | --- |
| `npm run dev` | Avvia Express da `src/api/server.ts` e serve la web UI |
| `npm run wot` | Avvia il Servient WoT HTTP/MQTT |
| `npm run controller` | Avvia il controller di termoregolazione |
| `npm run simulator -- valve1` | Avvia una valvola simulata con ID `valve1` |
| `npm run build` | Compila TypeScript in `dist/` |
| `npm run start` | Avvia l'API compilata da `dist/api/server.js` |
| `npm test` | Placeholder, al momento non esegue test reali |

## Flusso dei dati

1. Il simulatore pubblica `{ id: "valve1" }` su `ValveDirectory/actions/register`.
2. Il WoT server crea, se non esiste, la Thing `valve-valve1`.
3. La directory risponde con il setpoint iniziale, recuperato dal DB o impostato a `20`.
4. Il simulatore invia ogni 5 secondi la telemetria su `valve-valve1/actions/updateStatus`.
5. Il WoT server aggiorna le properties `temperature` e `heating` ed emette property change.
6. Il controller ascolta `valve-valve1/properties/temperature` e `valve-valve1/properties/setpoint`.
7. Il controller salva lo storico temperature, aggiorna lo stato della valvola e decide il nuovo `heating`.
8. Se serve, il controller invoca l'action HTTP `setHeating`.
9. La UI legge dati amministrativi da Express e dati live dal WoT server.

## Topic MQTT

Il progetto **non definisce un protocollo MQTT applicativo personalizzato** con topic di dominio come `home/valves/...`.

MQTT viene usato come trasporto della binding MQTT di **node-wot**: il simulatore e il controller pubblicano o sottoscrivono topic che corrispondono ad `actions` e `properties` delle Thing WoT.

| Topic | Direzione | Payload |
| --- | --- | --- |
| `ValveDirectory/actions/register` | simulatore -> WoT | `{ "id": "valve1" }` |
| `ValveDirectory/actions/register/responses` | WoT -> simulatore | `{ "setpoint": 20 }` |
| `ValveDirectory/properties/valves` | WoT -> controller | array di ID valvola |
| `valve-{id}/actions/updateStatus` | simulatore -> WoT | `{ "temperature": 20.2, "heating": false }` |
| `valve-{id}/properties/temperature` | WoT -> controller | numero |
| `valve-{id}/properties/heating` | WoT -> simulatore | booleano |
| `valve-{id}/properties/setpoint` | WoT -> controller/simulatore | numero |

La UI non si sottoscrive ai topic MQTT: legge le property live tramite endpoint HTTP WoT, ad esempio `/valve-valve1/properties/temperature`.

Esempio con `valve1`:

```text
valve-valve1/actions/updateStatus
valve-valve1/properties/temperature
valve-valve1/properties/heating
valve-valve1/properties/setpoint
```

## API REST

Base URL:

```text
http://localhost:3001
```

### Valvole

| Metodo | Endpoint | Descrizione |
| --- | --- | --- |
| `GET` | `/valves` | Lista valvole presenti nel DB |
| `GET` | `/valves/:id/history` | Ultime 50 letture di temperatura |
| `POST` | `/setpoint` | Aggiorna il setpoint di una valvola nel DB e nel controller |
| `PUT` | `/valves/:valveId/room` | Assegna o scollega una valvola da una stanza |
| `DELETE` | `/valves/:id` | Rimuove valvola da WoT, DB e controller |

Body per `POST /setpoint`:

```json
{
  "valveId": "valve1",
  "setpoint": 21.5
}
```

Body per `PUT /valves/:valveId/room`:

```json
{
  "roomId": "room1"
}
```

Per scollegare una valvola:

```json
{
  "roomId": null
}
```

### Override

| Metodo | Endpoint | Descrizione |
| --- | --- | --- |
| `POST` | `/override` | Forza temporaneamente `heating` ON/OFF |
| `GET` | `/overrides` | Lista override attivi |
| `DELETE` | `/override/:valveId` | Cancella un override attivo |

Body per `POST /override`:

```json
{
  "valveId": "valve1",
  "state": true,
  "duration": 60
}
```

`duration` è espresso in secondi.

### Stanze

| Metodo | Endpoint | Descrizione |
| --- | --- | --- |
| `GET` | `/rooms` | Lista stanze |
| `POST` | `/rooms` | Crea una stanza |
| `GET` | `/rooms/:id` | Dettaglio stanza |
| `GET` | `/rooms/:id/valves` | Valvole associate alla stanza |
| `PUT` | `/rooms/:id/setpoint` | Aggiorna setpoint globale e lo propaga alle valvole associate |
| `DELETE` | `/rooms/:id` | Elimina la stanza e scollega le valvole |
| `GET` | `/analytics/rooms` | Statistiche aggregate per stanza |

Body per `POST /rooms`:

```json
{
  "id": "room1",
  "name": "Soggiorno",
  "description": "Zona giorno",
  "globalSetpoint": 21
}
```

Body per `PUT /rooms/:id/setpoint`:

```json
{
  "setpoint": 22
}
```

## Web of Things

Il WoT server è definito in `src/wot/things.ts` e usa:

- `@node-wot/core`
- `@node-wot/binding-http`
- `@node-wot/binding-mqtt`

Base URL HTTP:

```text
http://localhost:8081
```

### Directory Thing

Thing title:

```text
ValveDirectory
```

Property:

- `valves`: lista degli ID delle valvole registrate

Action:

- `register`: registra una valvola e restituisce il setpoint iniziale

Endpoint usato dal frontend e dal controller:

```text
GET /valvedirectory/properties/valves
```

### Valve Thing

Per una valvola `valve1`, la Thing viene esposta come:

```text
valve-valve1
```

Properties:

- `temperature`: temperatura corrente, osservabile, numero in gradi Celsius
- `heating`: stato riscaldamento, osservabile, booleano
- `setpoint`: temperatura target, osservabile, numero in gradi Celsius

Actions:

- `updateStatus`: riceve telemetria dal simulatore
- `setHeating`: imposta lo stato del riscaldamento
- `setTargetTemperature`: aggiorna il setpoint e lo salva nel DB
- `delete`: rimuove la Thing

Esempi HTTP:

```bash
curl http://localhost:8081/valve-valve1/properties/temperature
curl http://localhost:8081/valve-valve1/properties/heating
curl http://localhost:8081/valve-valve1/properties/setpoint
```

## Frontend

La web app è servita da Express a partire da `public/index.html`.

Pagine disponibili:

- `dashboard`: panoramica valvole, metriche, grafici, stato live e storico
- `rooms`: creazione stanze, metriche per stanza, setpoint globale e cancellazione
- `settings`: selezione valvola, stato live, cambio setpoint, assegnazione stanza, override e rimozione valvola

File principali:

- `public/js/app.js`: router hash-based, tema chiaro/scuro/sistema, configurazione URL API/WoT
- `public/js/dashboard.js`: aggrega dati da REST e WoT, grafici e tabella valvole
- `public/js/rooms.js`: CRUD principale delle stanze
- `public/js/settings.js`: gestione operativa delle singole valvole
- `public/css/style.css`: stile dell'interfaccia

Origine dati:

- Express REST: stanze, storico, associazioni, override, stato persistito
- WoT HTTP: temperatura, heating, setpoint e lista valvole live

## Database

SQLite viene inizializzato in `src/db/database.ts`.

Path di default:

```text
thermostat.db
```

### `valves`

| Colonna | Tipo | Significato |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | ID valvola, ad esempio `valve1` |
| `setpoint` | `REAL` | Temperatura target |
| `heating` | `INTEGER` | Stato riscaldamento, `0` o `1` |
| `status` | `TEXT` | `ONLINE` o `OFFLINE` |
| `last_seen` | `DATETIME` | Ultimo aggiornamento |
| `temperature` | `REAL` | Ultima temperatura nota |
| `room_id` | `TEXT` | Stanza associata |

### `rooms`

| Colonna | Tipo | Significato |
| --- | --- | --- |
| `id` | `TEXT PRIMARY KEY` | ID stanza |
| `name` | `TEXT NOT NULL` | Nome leggibile |
| `description` | `TEXT` | Descrizione opzionale |
| `global_setpoint` | `REAL` | Setpoint comune della stanza |

### `temperature_readings`

| Colonna | Tipo | Significato |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | ID lettura |
| `valve_id` | `TEXT` | Valvola associata |
| `temperature` | `REAL` | Temperatura registrata |
| `timestamp` | `DATETIME` | Timestamp della lettura |

## Ontologia

Il file `ontology.ttl` descrive il dominio semantico del termostato:

- classi `Valve` e `ValveDirectory`
- relazione `managesValve`
- proprietà `hasTemperature`, `hasHeating`, `hasSetpoint`
- classi azione `RegisterAction`, `UpdateStatusAction`, `SetHeatingAction`, `SetTargetTemperatureAction`, `DeleteAction`

I file in `src/wot/models/` definiscono i modelli WoT astratti, cioe la struttura riusabile di valvole e directory. I file in `src/wot/descriptions/` generano invece le Thing Description concrete passate a `wot.produce(...)`, aggiungendo `title` e `description` specifici dell'istanza.

## Struttura del progetto

```text
.
├── ontology.ttl
├── package.json
├── thermostat.db
├── tsconfig.json
├── public/
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── dashboard.js
│   │   ├── rooms.js
│   │   └── settings.js
│   └── pages/
│       ├── dashboard.html
│       ├── rooms.html
│       └── settings.html
└── src/
    ├── api/server.ts
    ├── controller/controller.ts
    ├── db/database.ts
    ├── db/repository.ts
    ├── simulator/valveSimulator.ts
    ├── utils/logger.ts
    └── wot/
        ├── descriptions/
        │   ├── directoryThingDescription.ts
        │   └── valveThingDescription.ts
        ├── models/
        │   ├── directoryThingModel.ts
        │   └── valveThingModel.ts
        ├── things.ts
```

## Esempi rapidi

Creare una stanza:

```bash
curl -X POST http://localhost:3001/rooms \
  -H "Content-Type: application/json" \
  -d '{"id":"room1","name":"Soggiorno","description":"Zona giorno","globalSetpoint":21}'
```

Assegnare una valvola alla stanza:

```bash
curl -X PUT http://localhost:3001/valves/valve1/room \
  -H "Content-Type: application/json" \
  -d '{"roomId":"room1"}'
```

Attivare un override ON per 60 secondi:

```bash
curl -X POST http://localhost:3001/override \
  -H "Content-Type: application/json" \
  -d '{"valveId":"valve1","state":true,"duration":60}'
```

Leggere gli override attivi:

```bash
curl http://localhost:3001/overrides
```

Leggere la temperatura live via WoT:

```bash
curl http://localhost:8081/valve-valve1/properties/temperature
```

## Note tecniche

- Il controller resetta lo stato delle valvole a `OFFLINE` al boot.
- Una valvola torna `ONLINE` quando il controller riceve nuovamente aggiornamenti WoT.
- Il controller rileva inattività ogni 10 secondi e marca una valvola `OFFLINE` dopo 30 secondi senza aggiornamenti.
- Lo storico restituito da `/valves/:id/history` è ordinato dal più recente al meno recente e limitato a 50 righe.
- La cancellazione di una valvola tenta prima di invocare l'action WoT `delete`, poi rimuove dati da DB e controller.
- Le pagine `details` e `wot` sono citate nel router, ma nel repository attuale non sono presenti i file HTML/JS corrispondenti.
