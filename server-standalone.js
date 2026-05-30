/**
 * HopeMission LRF — API + static server (Node stdlib only)
 * Run: node server-standalone.js
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { getSeedStore } = require("./seed-data");

const PORT = Number(process.env.PORT) || 3001;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

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

const LEAVE_TYPES = [
  "Sick Leave",
  "Vacation",
  "Personal Day",
  "Bereavement",
  "Compassionate Leave",
  "Unpaid Leave",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function isContractRole(role) {
  return role === "Part-Time / Contract Staff" || role === "FTT Staff";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function resolveCostCentre(dept) {
  return COST_CENTRES[dept] || "UNASSIGNED";
}

function genRequestId(num) {
  const n = String(num).padStart(3, "0");
  return `LRF-2026-${n}`;
}

function readStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    const seed = getSeedStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(seed, null, 2));
    return seed;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    if (!parsed.version || parsed.version < 3 || !Array.isArray(parsed.employees)) {
      return applySeed();
    }
    if (!parsed.seeded || !parsed.employees.length) {
      return applySeed();
    }
    parsed.employees = parsed.employees || [];
    parsed.requests = parsed.requests || [];
    parsed.session = parsed.session || { empId: parsed.employees[0]?.id, interface: "employee" };
    return parsed;
  } catch {
    return applySeed();
  }
}

function writeStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function applySeed() {
  const seed = getSeedStore();
  writeStore(seed);
  return seed;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  let urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const fallback = path.join(ROOT, "index.html");
    if (!fs.existsSync(fallback)) return sendJson(res, 404, { error: "Not found" });
    return streamFile(res, fallback);
  }
  streamFile(res, filePath);
}

function streamFile(res, filePath) {
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
    "Content-Length": data.length,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function publicState(store) {
  return {
    appName: store.appName || "HopeMission LRF Application",
    seeded: !!store.seeded,
    session: store.session,
    employees: store.employees,
    requests: store.requests,
    leaveTypes: LEAVE_TYPES,
    departments: Object.keys(COST_CENTRES),
    stats: {
      total: store.requests.length,
      pending: store.requests.filter((r) => r.status === "pending").length,
      approved: store.requests.filter((r) => r.status === "approved" || r.status === "taken").length,
      rejected: store.requests.filter((r) => r.status === "rejected").length,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      const store = readStore();
      return sendJson(res, 200, {
        ok: true,
        service: "hopemission-lrf-api",
        appName: store.appName,
        seeded: store.seeded,
        employees: store.employees.length,
        requests: store.requests.length,
        time: new Date().toISOString(),
      });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const store = readStore();
      return sendJson(res, 200, publicState(store));
    }

    if (req.method === "POST" && pathname === "/api/seed") {
      const store = applySeed();
      return sendJson(res, 200, { message: "Demo data loaded.", ...publicState(store) });
    }

    if (req.method === "PUT" && pathname === "/api/session") {
      const body = await readBody(req);
      const store = readStore();
      if (body.empId) store.session.empId = body.empId;
      if (body.interface) store.session.interface = body.interface;
      writeStore(store);
      return sendJson(res, 200, store.session);
    }

    if (req.method === "POST" && pathname === "/api/requests") {
      const body = await readBody(req);
      const store = readStore();
      const emp = store.employees.find((e) => e.id === body.empId);
      if (!emp) return sendJson(res, 400, { error: "Employee not found." });

      const reason = String(body.reason || "").trim();
      if (!reason) return sendJson(res, 400, { error: "reason is required." });

      let leaveDates = Array.isArray(body.leaveDates)
        ? body.leaveDates.map((d) => String(d).trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        : [];
      leaveDates = [...new Set(leaveDates)].sort();

      const hourDistribution = Array.isArray(body.hourDistribution)
        ? body.hourDistribution
            .map((row) => ({
              type: String(row.type || "").trim(),
              hours: Number(row.hours),
            }))
            .filter((row) => row.type && row.hours > 0)
        : [];

      const payPeriod = body.payPeriod || {};
      const payPeriodLabel =
        String(body.payPeriodLabel || payPeriod.label || "").trim() || null;

      if (!leaveDates.length && body.startDate) {
        const s = String(body.startDate).trim();
        const e = String(body.endDate || s).trim();
        leaveDates = [s];
        if (e !== s) leaveDates.push(e);
      }

      if (!leaveDates.length) {
        return sendJson(res, 400, { error: "At least one intended leave date is required." });
      }
      if (!payPeriodLabel && !payPeriod.start) {
        return sendJson(res, 400, { error: "Pay period is required." });
      }
      if (!hourDistribution.length && !body.leaveType) {
        return sendJson(res, 400, { error: "Hour distribution by leave type is required." });
      }

      const totalHours =
        Number(body.totalHours) > 0
          ? Number(body.totalHours)
          : hourDistribution.reduce((s, r) => s + r.hours, 0) ||
            Number(body.hours) ||
            leaveDates.length * 8;

      const distSum = hourDistribution.reduce((s, r) => s + r.hours, 0);
      if (hourDistribution.length && Math.abs(totalHours - distSum) > 0.01) {
        return sendJson(
          res,
          400,
          { error: `Total hours (${totalHours}) must match distribution (${distSum}).` }
        );
      }

      const startDate = leaveDates[0];
      const endDate = leaveDates[leaveDates.length - 1];
      const days =
        Number(body.days) > 0
          ? Number(body.days)
          : leaveDates.length;

      let leaveType = String(body.leaveType || "").trim();
      if (!leaveType) {
        leaveType =
          hourDistribution.length === 1
            ? hourDistribution[0].type
            : "Mixed leave types";
      }

      const retro = Boolean(body.retroactive);
      const hasUnpaid =
        hourDistribution.some((r) => r.type === "Unpaid Leave") ||
        leaveType === "Unpaid Leave" ||
        isContractRole(emp.jobRole);

      const reqRecord = {
        id: genRequestId(store.nextRequestNum++),
        empId: emp.id,
        empName: emp.name,
        initials: emp.initials,
        department: emp.department,
        costCentre: emp.costCentre,
        managerId: emp.managerId,
        managerName: emp.managerName,
        leaveType,
        leaveDates,
        payPeriod: payPeriod.start
          ? { start: payPeriod.start, end: payPeriod.end, label: payPeriodLabel }
          : { label: payPeriodLabel },
        payPeriodLabel,
        hourDistribution,
        totalHours,
        reason,
        startDate,
        endDate,
        days,
        hours: totalHours,
        status: retro ? "taken" : "pending",
        payStatus: hasUnpaid ? "without_pay" : "paid",
        submittedAt: new Date().toISOString(),
        managerComment: null,
      };

      store.requests.unshift(reqRecord);
      writeStore(store);
      return sendJson(res, 201, reqRecord);
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/requests/")) {
      const id = decodeURIComponent(pathname.slice("/api/requests/".length));
      const body = await readBody(req);
      const store = readStore();
      const item = store.requests.find((r) => r.id === id);
      if (!item) return sendJson(res, 404, { error: "Request not found." });

      if (body.status === "approved" || body.status === "rejected") {
        const approver = store.employees.find((e) => e.id === store.session.empId);
        item.status = body.status;
        item.managerComment = body.managerComment || (body.status === "approved" ? "Approved." : "Rejected.");
        item.decidedAt = new Date().toISOString();
        item.approvedAt = item.decidedAt;
        if (approver) {
          item.approvedById = approver.id;
          item.approvedByName = approver.name;
        }
      }
      writeStore(store);
      return sendJson(res, 200, item);
    }

    /* Legacy flat records API */
    if (req.method === "GET" && pathname === "/api/leaves") {
      const store = readStore();
      const flat = store.requests.map((r) => ({
        id: r.id,
        fullName: r.empName,
        role: store.employees.find((e) => e.id === r.empId)?.jobRole || "",
        group: r.department,
        date: r.startDate,
        status: r.status === "approved" || r.status === "taken" ? "present" : r.status,
        timeMarked: r.submittedAt,
        costCentre: r.costCentre,
        hours: r.hours,
        leaveCategory: r.leaveType,
        isRetroactive: r.status === "taken",
        employeeType: r.payStatus === "without_pay" ? "Contract" : "Full-Time",
        managerComment: r.managerComment,
      }));
      return sendJson(res, 200, flat);
    }

    if (req.method === "GET" && !pathname.startsWith("/api")) {
      return serveStatic(req, res);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  const store = readStore();
  console.log(`HopeMission LRF: http://localhost:${PORT}`);
  console.log(`API health:      http://localhost:${PORT}/api/health`);
  console.log(`Demo seeded:     ${store.seeded} (${store.requests.length} requests, ${store.employees.length} employees)`);
});
