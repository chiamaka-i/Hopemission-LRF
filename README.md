# HopeMission LRF Application

Canadian NGO leave request workflow with **Employee**, **Manager**, and **Admin/HR** interfaces. Demo seed data lives on the server in `data/store.json`.

The frontend (`index.html` + `app.js`) talks to the REST API — check the green **Backend linked** pill in the header when connected.

## Run the stack

### Option A — Node.js (no npm required)

Uses built-in Node only (`server-standalone.js`):

```bash
cd c:\Users\Blessen\Desktop\APP
node server-standalone.js
```

With Express (needs `npm install` first):

```bash
npm install
npm run start:express
```

Open **http://localhost:3001**

### Option B — Python (no npm)

```bash
cd c:\Users\Blessen\Desktop\APP
python server.py
```

Open **http://localhost:3001**

> Do **not** open `index.html` as a `file://` URL if you want API sync — use the server URL so the browser can call `/api/leaves`.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/leaves` | List all leave records |
| POST | `/api/leaves` | Create one record |
| PATCH | `/api/leaves/:id` | Update status / manager comment |
| PUT | `/api/leaves` | Replace full record list |
| DELETE | `/api/leaves/:id` | Delete one record |

Data is persisted in `data/store.json`.

## Frontend configuration

By default the app uses **same-origin** requests (empty `ATTENDNOW_API`), which works when you use `npm start` or `python server.py`.

If the UI is hosted on another port or domain, set this before `app.js` loads:

```html
<script>window.ATTENDNOW_API = "http://localhost:3001";</script>
```

If the API is down, the app falls back to `localStorage` and shows a warning toast.

## LeaveFlow NG (full dashboard)

The large LeaveFlow HTML/JS you have uses an in-memory `Store` with `localStorage`. To connect it to this API, replace `Store` persistence with `fetch` calls to the endpoints above (or extend `server.js` with `/api/employees` and `/api/requests` for the full seed model).
