# 🌡️ Progetto Automazione — Smart Thermostat

Applicazione Node.js/TypeScript per simulare e controllare un sistema di riscaldamento con **valvole smart**, **MQTT**, **SQLite**, **API HTTP** e integrazione **Web of Things**.

Il progetto include:

- un **controller** che decide quando accendere o spegnere il riscaldamento
- un **simulatore** di valvole che invia temperature via MQTT
- una **API HTTP Express** per consultare e modificare dati persistiti
- una **persistenza dati** su SQLite
- una **dashboard web** statica servita dalla stessa app
- un’integrazione **node-wot** per leggere/esporre lo stato live delle valvole come Thing
+
+Il frontend usa un approccio **ibrido**:
+
+- **Express** per stanze, storico, setpoint, assegnazione valvole e operazioni CRUD
+- **WoT** per lo stato live delle valvole, in particolare temperatura e heating

---

## Indice

- [Obiettivo del progetto](#obiettivo-del-progetto)
- [Tecnologie utilizzate](#tecnologie-utilizzate)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Comandi disponibili](#comandi-disponibili)
- [Configurazione](#configurazione)
- [Architettura](#architettura)
- [Topic MQTT](#topic-mqtt)
- [API HTTP](#api-http)
- [Web interface](#web-interface)
- [Web of Things](#web-of-things)
- [Struttura del progetto](#struttura-del-progetto)
- [Note utili](#note-utili)

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

## Requisiti

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

## Prossimi miglioramenti possibili

- aggiungere test automatici
- separare meglio frontend e backend
- configurare un file di ambiente completo
- aggiungere validazione più robusta sugli input
- migliorare la dashboard con grafici storici e filtri
