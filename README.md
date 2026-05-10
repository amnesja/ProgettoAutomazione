# 🌡️ Progetto Automazione — Smart Thermostat

Documentazione tecnica del progetto **ProgettoAutomazione**.

Questo repository implementa un sistema di termoregolazione simulato composto da:

- **Simulatore valvole** (Node.js/MQTT) che pubblica temperature e riceve comandi
- **Controller MQTT** che:
  - applica **isteresi** per decidere ON/OFF riscaldamento
  - gestisce **override manuali temporanei**
  - marca una valvola come **OFFLINE** se non riceve dati
  - aggiorna lo stato su **SQLite** e invia comandi verso le valvole
- **API HTTP (Express)** per consultare/modificare dati su SQLite e servire la web UI
- **Web of Things (WoT)** (node-wot) per esporre lo stato live come Thing osservabili
- **Frontend** SPA (Bootstrap + Chart.js) che usa sia REST sia WoT per lo stato live

---

## Indice (navigazione rapida)

- [Panoramica: cosa fa il sistema](#panoramica-cosa-fa-il-sistema)
- [Componenti principali](#componenti-principali)
- [Flusso end-to-end (simulatore ↔ MQTT ↔ controller ↔ DB ↔ API ↔ frontend)](#flusso-end-to-end-simulatore--mqtt--controller--db--api--frontend)
- [Flusso WoT (aggiornamento live)](#flusso-wot-aggiornamento-live)
- [Tecnologie utilizzate](#tecnologie-utilizzate)
- [Requisiti e porte](#requisiti-e-porte)
- [Installazione](#installazione)
- [Comandi disponibili](#comandi-disponibili)
- [Configurazione (.env)](#configurazione-env)
- [Architettura per file (responsabilità e dettagli)](#architettura-per-file-responsabilita-e-dettagli)
  - [src/api/server.ts](#srcapiserversart)
  - [src/controller/controller.ts](#srcc-controllercontroller-ts)
  - [src/simulator/valveSimulator.ts](#srcs-simulatorvalvesimulator-ts)
  - [src/db/database.ts](#srcdbdatabasets)
  - [src/db/repository.ts](#srcdbrepositoryts)
  - [src/mqtt/mqttClient.ts](#srcmqttmqttclientts)
  - [src/utils/logger.ts](#srcutilsloggerts)
  - [src/wot/things.ts](#srcwotthingsts)
  - [Frontend: public/index.html](#frontend-publicindexhtml)
  - [Frontend: public/js/app.js](#frontend-publicjsappjs)
  - [Frontend: public/js/dashboard.js](#frontend-publicjsdashboardjs)
  - [Frontend: public/js/rooms.js](#frontend-publicjsroomsjs)
  - [Frontend: public/js/settings.js](#frontend-publicjssettingsjs)
  - [Frontend: pagine pubblicate](#frontend-pagine-pubblicate)
  - [Frontend: CSS public/css/style.css](#frontend-css-publiccssstylecss)
- [Topic MQTT e payload JSON](#topic-mqtt-e-payload-json)
- [API HTTP: endpoint reali e payload attesi](#api-http-endpoint-reali-e-payload-attesi)
- [WoT: Thing model e come viene popolato](#wot-thing-model-e-come-viene-popolato)
- [Schema SQLite (tabelle e colonne)](#schema-sqlite-tabelle-e-colonne)
- [Log e tracciamento eventi](#log-e-tracciamento-eventi)
- [Gap / Note (incoerenze o parti richiamate ma non presenti)](#gap--note-incoerenze-o-parti-richiamate-ma-non-presenti)
- [Esempi di test rapidi (curl)](#esempi-di-test-rapidi-curl)
- [Prossimi miglioramenti possibili](#prossimi-miglioramenti-possibili)


---

## Panoramica: cosa fa il sistema

Il sistema simula una rete di valvole termostatiche e mette insieme **controllo logico**, **persistenza**, **comunicazione MQTT**, **API HTTP** e **esposizione WoT**.

In particolare:

- ogni **valvola simulata** pubblica periodicamente la sua **temperatura** su MQTT
- il **controller** ascolta le temperature e decide se inviare comando `heating: true/false`
  usando una logica a **isteresi** (evita continue commutazioni)
- il controller supporta anche un **override manuale** temporaneo (ON/OFF forzato)
- ogni lettura viene memorizzata su **SQLite** e lo stato valvola è consultabile via **REST**
- la **web UI** combina:
  - stato persistito (DB/REST)
  - stato live (WoT properties `temperature` e `heating`)

---

## Componenti principali

1. **Simulatore valvole** (`src/simulator/valveSimulator.ts`)
   - pubblica su MQTT: `home/valves/{id}/temperature`
   - riceve comandi MQTT da: `home/valves/{id}/command`
2. **Controller MQTT** (`src/controller/controller.ts`)
   - sottoscrive: `home/valves/+/temperature`
   - calcola ON/OFF con isteresi e override
   - aggiorna DB (valvole + storico)
   - pubblica comandi verso i topic valvola
3. **API HTTP + static files** (`src/api/server.ts`)
   - espone endpoint REST per DB
   - serve la SPA e le sue pagine da `public/`
4. **Database SQLite** (`src/db/database.ts`, `src/db/repository.ts`)
   - schema tabelle + query per CRUD/analitiche
5. **WoT** (`src/wot/things.ts`)
   - crea Thing per ogni valvola e una directory Thing
   - aggiorna proprietà osservabili leggendo i messaggi MQTT

---

## Flusso end-to-end (simulatore ↔ MQTT ↔ controller ↔ DB ↔ API ↔ frontend)

1. Avvio simulatore:
   - il simulatore parte e inizia a pubblicare `{ temperature, heating }`
   - ritmo di pubblicazione: **ogni 5s** (via `setInterval`)
2. Controller MQTT:
   - riceve messaggi su `home/valves/+/temperature`
   - salva temperature su tabella `temperature_readings`
   - aggiorna `valves` con `temperature`, `heating`, `setpoint`, `status`
   - applica:
     - **isteresi** rispetto al `setpoint`
     - eventuale **override** se attivo
     - **OFFLINE timeout** se non riceve dati
   - invia comando su `home/valves/{id}/command`
3. Database:
   - letture -> storico (ultime 50 letture per history endpoint)
   - calcoli -> analytics per stanza
4. API HTTP:
   - frontend interroga:
     - `/rooms`, `/valves`, `/valves/:id/history`
     - override: `/override` (POST) e `/override/:valveId` (DELETE)
     - assegnazione valvola: `/valves/:valveId/room` (PUT)
5. Frontend (SPA):
   - dashboard ogni **5s** rilegge DB + WoT directory
   - settings ogni 20s ricarica layout + ogni 3s aggiorna campi numerici

---

## Flusso WoT (aggiornamento live)

- `src/wot/things.ts` collega un `HttpServer` su `WOT_PORT` (default **8081**)
- si connette al broker MQTT e ascolta `home/valves/+/temperature`
- ogni volta che arriva una temperatura:
  - aggiorna `valveStates[valveId] = { temperature, heating }`
  - se la Thing per quella valvola non esiste ancora la crea on-demand
- le properties WoT `temperature` e `heating` sono `observable: true` e vengono lette dalla UI
---



## Tecnologie utilizzate

- **Node.js**
- **TypeScript**
- **Express 5**
- **MQTT**
- **better-sqlite3**
- **SQLite**
- **dotenv**
- **Bootstrap 5**
- **Chart.js**
- **node-wot** (`@node-wot/core`, `@node-wot/binding-http`)

---

## Requisiti e porte

Prima di eseguire il progetto servono:

- **Node.js** installato

- un **broker MQTT** attivo, ad esempio Mosquitto su `mqtt://localhost:1883`
- accesso alla porta:
  - `3001` per l’API / sito web
  - `8081` per l’esposizione WoT

---

## Installazione

Clona il repository e installa le dipendenze:

```bash
npm install
```

---

## Comandi disponibili

### Avvio API + sito web
Avvia il server Express che espone API e contenuti statici:

```bash
npm run dev
```

Di default l’app ascolta su:

- `http://localhost:3001`

---

### Avvio controller MQTT
Avvia la logica di controllo che:

- ascolta le temperature delle valvole
- applica isteresi
- gestisce override manuali
- marca le valvole offline se non ricevono dati

```bash
npm run controller
```

---

### Avvio simulatore valvole
Avvia un simulatore di valvola.

Esempio:

```bash
npm run simulator -- valve1
```

Se non passi un ID, usa `valve1` come default.

---

### Avvio Web of Things
Esporta le valvole come oggetti WoT via HTTP:

```bash
npm run wot
```

L’endpoint WoT parte su:

- `http://localhost:8081`

---

### Build del progetto
Compila il TypeScript in `dist/`:

```bash
npm run build
```

---

### Avvio produzione
Avvia l’API compilata da `dist/`:

```bash
npm run start
```

> Nota: prima devi eseguire `npm run build`.

---

### Test
Lo script test al momento è solo un placeholder:

```bash
npm test
```

---

## Configurazione

Il progetto legge le variabili d’ambiente tramite `dotenv`.

Crea un file `.env` nella root del progetto, ad esempio:

```env
MQTT_BROKER=mqtt://localhost:1883
PORT=3001
```

### Variabili principali

- `MQTT_BROKER`: URL del broker MQTT
- `PORT`: porta dell’API Express

Se non impostate, vengono usati i default:

- `MQTT_BROKER = mqtt://localhost:1883`
- `PORT = 3001`

---

## Architettura

### 1. Simulatore valvole
`src/simulator/valveSimulator.ts`

- invia periodicamente il valore di temperatura
- ascolta i comandi `home/valves/{id}/command`
- modifica la temperatura in base allo stato `heating`

### 2. Controller
`src/controller/controller.ts`

- ascolta `home/valves/+/temperature`
- applica la logica di controllo con isteresi
- gestisce override temporanei
- aggiorna lo stato delle valvole nel database
- rileva valvole offline

### 3. API HTTP
`src/api/server.ts`

- espone endpoint REST per valvole, stanze e override
- serve la UI statica da `public/`
- permette consultazione e modifica del database

### 4. Database
`src/db/database.ts` e `src/db/repository.ts`

- persistenza locale su SQLite
- gestione di valvole, stanze e storico temperature
- calcolo di statistiche aggregate per stanza

### 5. Web of Things
`src/wot/things.ts`

- crea Thing dinamici per le valvole
- legge lo stato aggiornato via MQTT
- espone proprietà e azioni via HTTP

---

## Topic MQTT

### Temperature della valvola
```text
home/valves/{id}/temperature
```

Messaggio pubblicato dal simulatore, ad esempio:

```json
{
  "temperature": "20.50",
  "heating": false
}
```

---

### Comando alla valvola
```text
home/valves/{id}/command
```

Messaggio pubblicato dal controller:

```json
{
  "heating": true
}
```

---

## API HTTP

Il server API è definito in `src/api/server.ts`.

Queste API vengono usate dalla UI per:
- leggere e aggiornare stanze
- recuperare storico e metadati delle valvole
- modificare setpoint e assegnazioni
- gestire override e analitiche

### Valvole

#### `GET /valves`
Restituisce tutte le valvole presenti nel database.

#### `GET /valves/:id/history`
Restituisce lo storico temperature di una valvola.

Esempio:
```bash
curl http://localhost:3001/valves/valve1/history
```

#### `POST /setpoint`
Aggiorna il setpoint di una valvola.

Body esempio:

```json
{
  "valveId": "valve1",
  "setpoint": 21
}
```

#### `POST /override`
Attiva un override manuale temporaneo.

Body esempio:

```json
{
  "valveId": "valve1",
  "state": true,
  "duration": 60
}
```

#### `GET /overrides`
Elenca gli override attivi.

#### `DELETE /override/:valveId`
Cancella un override attivo.

---

### Stanze

#### `GET /rooms`
Restituisce tutte le stanze.

#### `POST /rooms`
Crea una nuova stanza.

Body esempio:

```json
{
  "id": "room1",
  "name": "Soggiorno",
  "description": "Zona giorno",
  "globalSetpoint": 21
}
```

#### `GET /rooms/:id`
Restituisce i dettagli di una stanza.

#### `PUT /rooms/:id/setpoint`
Aggiorna il setpoint globale di una stanza.

Body esempio:

```json
{
  "setpoint": 22
}
```

#### `GET /rooms/:id/valves`
Restituisce le valvole assegnate a una stanza.

#### `PUT /valves/:valveId/room`
Assegna una valvola a una stanza.

Body esempio:

```json
{
  "roomId": "room1"
}
```

#### `GET /analytics/rooms`
Restituisce statistiche aggregate per stanza:

- numero valvole
- temperatura media
- numero di valvole con riscaldamento attivo

---

## Web interface

La UI è servita da `public/index.html`.

### Funzioni principali

- dashboard generale
- dettaglio valvole
- gestione stanze
- impostazioni
- grafici e visualizzazione dati

### Origine dei dati

- **Dashboard**: combina dati da **Express** (`/valves`, `/rooms`, storico) e da **WoT** per i valori live di `temperature` e `heating`
- **Dettagli**: usa principalmente le API **Express** per stato, stanza e storico della valvola
- **Stanze**: usa le API **Express** per elenco, creazione e aggiornamento setpoint

### Librerie frontend
- Bootstrap 5
- Chart.js

---

## Web of Things

Lo script `src/wot/things.ts` espone:

- un Thing per ogni valvola rilevata
- proprietà:
  - `temperature`
  - `heating`
- azione:
  - `setHeating`

Espone anche un Thing directory con la lista delle valvole disponibili.

---

## Gap / Note (incoerenze o parti richiamate ma non presenti)

### Pagine SPA richiamate ma non presenti/complete

Nel router SPA (`public/js/app.js`) esiste un case per `details`:
- `case "details": await initDetails();`

Nel repository, dai file frontend enumerati, non risulta presente l’implementazione di `initDetails`.
Inoltre `public/pages/details.html` può risultare non sincronizzato rispetto all’enumerazione file del workspace (quindi potrebbe non essere realmente presente o essere incompleta).

### WoT: URL directory Thing

Frontend: `http://localhost:8081/valvedirectory/properties/valves`

Backend: crea una directory Thing con titolo `"ValveDirectory"`.
Il path HTTP nella binding HTTP di node-wot dipende dal `title` normalizzato; se l’URL effettiva non coincide con `valvedirectory`, va riallineato titolo e/o URL nel frontend.

### Azione WoT di delete

Frontend `public/js/settings.js` usa:
- `POST http://localhost:8081/valve-${valveId}/actions/delete`

Questo presuppone che l’azione `delete` esposta dalla Thing sia effettivamente presente nel binding HTTP con quel naming.

---

## Struttura del progetto

```text
public/
  index.html
  css/
  js/
  pages/

src/
  api/
  controller/
  db/
  mqtt/
  simulator/
  utils/
  wot/
```

### File principali

- `src/api/server.ts` — API REST e server statico
- `src/controller/controller.ts` — logica di controllo
- `src/simulator/valveSimulator.ts` — simulatore valvola
- `src/mqtt/mqttClient.ts` — client MQTT di test
- `src/db/database.ts` — schema SQLite
- `src/db/repository.ts` — funzioni di accesso ai dati
- `src/wot/things.ts` — esposizione WoT

---

## Note utili

- Il database locale è `thermostat.db`
- Le valvole valide seguono il pattern `valveN` ad esempio `valve1`, `valve2`, `valve10`
- Il controller usa una logica con **isteresi** per evitare continue accensioni e spegnimenti
- Una valvola viene marcata **OFFLINE** se non invia dati per 30 secondi
- La documentazione è allineata all’implementazione attuale del progetto

---

## Flusso di sviluppo consigliato

Se vuoi provare il sistema in locale, avvia i componenti in quest’ordine:

1. broker MQTT
2. controller
3. simulatore valvola
4. API / web app
5. browser su `http://localhost:3001`

Esempio:

```bash
npm run controller
npm run simulator -- valve1
npm run dev
```

Poi apri:

- `http://localhost:3001`

---

