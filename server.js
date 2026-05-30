/**
 * Leave / LRF API server
 * Serves static frontend (index.html, app.js) and persists records to data/store.json
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const PORT = Number(process.env.PORT) || 3001;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore() {
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    const empty = { records: [] };
    fs.writeFileSync(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return { records: [] };
    return parsed;
  } catch {
    return { records: [] };
  }
}

function writeStore(store) {
  ensureDataDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function genId() {
  return `lrf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Health ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "leaveflow-api", time: new Date().toISOString() });
});

// ── Leave records (AttendNow / LRF client shape) ─────────────────────────────

/** List all leave records (newest first). */
app.get("/api/leaves", (_req, res) => {
  const store = readStore();
  const sorted = [...store.records].sort(
    (a, b) => new Date(b.timeMarked || 0) - new Date(a.timeMarked || 0)
  );
  res.json(sorted);
});

/** Create one leave record. */
app.post("/api/leaves", (req, res) => {
  const body = req.body || {};
  const fullName = String(body.fullName || "").trim();
  const role = String(body.role || "").trim();
  const group = String(body.group || "").trim();
  const date = String(body.date || "").trim();

  if (!fullName || !role || !group || !date) {
    return res.status(400).json({
      error: "fullName, role, group, and date are required.",
    });
  }

  const record = {
    id: body.id || genId(),
    fullName,
    role,
    group,
    date,
    status: body.status || "present",
    timeMarked: body.timeMarked || new Date().toISOString(),
    costCentre: body.costCentre || resolveCostCentre(group),
    hours: Number(body.hours) > 0 ? Number(body.hours) : 8,
    leaveCategory:
      body.leaveCategory ||
      (isContractRole(role) ? "Without Pay" : "Logged Leave"),
    isRetroactive: Boolean(body.isRetroactive ?? date < todayISO()),
    employeeType: body.employeeType || (isContractRole(role) ? "Contract" : "Full-Time"),
  };

  const store = readStore();
  store.records.unshift(record);
  writeStore(store);

  res.status(201).json(record);
});

/** Update status (approve / reject / pending). */
app.patch("/api/leaves/:id", (req, res) => {
  const store = readStore();
  const idx = store.records.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Record not found." });

  const { status, managerComment } = req.body || {};
  if (status) store.records[idx].status = status;
  if (managerComment !== undefined) store.records[idx].managerComment = managerComment;
  store.records[idx].updatedAt = new Date().toISOString();

  writeStore(store);
  res.json(store.records[idx]);
});

/** Replace entire record list (sync / import). */
app.put("/api/leaves", (req, res) => {
  const incoming = req.body?.records ?? req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: "Expected array of records or { records: [] }." });
  }
  writeStore({ records: incoming });
  res.json({ count: incoming.length });
});

/** Delete one record. */
app.delete("/api/leaves/:id", (req, res) => {
  const store = readStore();
  const before = store.records.length;
  store.records = store.records.filter((r) => r.id !== req.params.id);
  if (store.records.length === before) {
    return res.status(404).json({ error: "Record not found." });
  }
  writeStore(store);
  res.status(204).end();
});

// ── Helpers (mirror frontend app.js) ─────────────────────────────────────────

const COST_CENTRES = {
  "Executive Leadership": "EXEC-100",
  "Programs & Services": "PROG-200",
  "Community Engagement": "COMM-210",
  "Fundraising & Development": "FUND-220",
  "Finance & Administration": "FIN-110",
  "Human Resources": "HR-120",
  "Communications & Marketing": "COMMS-130",
  "Volunteer Services": "VOL-140",
  "Operations & Facilities": "OPS-150",
  "Advocacy & Policy": "ADV-160",
  "Indigenous & Community Partnerships": "ICP-170",
  "Grant Management": "GRANT-180",
};

function isContractRole(role) {
  return role === "Part-Time / Contract Staff" || role === "FTT Staff";
}

function resolveCostCentre(group) {
  return COST_CENTRES[group] || "UNASSIGNED";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Static frontend ──────────────────────────────────────────────────────────

app.use(express.static(ROOT));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const file = path.join(ROOT, req.path === "/" ? "index.html" : req.path);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    return res.sendFile(file);
  }
  res.sendFile(path.join(ROOT, "index.html"));
});

app.listen(PORT, () => {
  ensureDataDir();
  readStore();
  console.log(`LeaveFlow API + frontend: http://localhost:${PORT}`);
  console.log(`API health check:         http://localhost:${PORT}/api/health`);
});
