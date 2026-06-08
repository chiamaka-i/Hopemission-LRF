# Hope Mission LRF

Leave request workflow for Hope Mission with **Employee**, **Manager**, and **Admin/HR** interfaces. Leave is tracked in **hours and days only** — no currency.

Data is stored on the server in `data/store.json`.

## Run

```bash
cd c:\Users\Blessen\Desktop\APP
node server-standalone.js
```

Open **http://localhost:3001**

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/state` | Employees, requests, leave types |
| POST | `/api/requests` | Submit leave request |
| PATCH | `/api/requests/:id` | Approve / reject |
| PUT | `/api/session` | Current user / interface |
