/**
 * Hope Mission LRF — API + static server (Node stdlib only)
 * Run: node server-standalone.js
 *
 * DEMO: POST /api/seed and seed-data.js must be removed or disabled before
 * real organisational deployment.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { getSeedStore } = require("./seed-data");
const {
  LEAVE_CATEGORIES,
  EMPLOYMENT_TYPES,
  SHIFT_LENGTHS,
  PORTAL_ROLES,
  FTT_REVIEW_MSG,
  NO_PORTAL_ACCESS_MSG,
  canAccessPortal,
  categoriesForEmploymentType,
  evaluateLeaveSubmission,
  summarizeLeaveTypes,
} = require("./constants");
const {
  CORRECTION_REASONS,
  isAdminRole,
  isAdminOrHr,
  buildMsFormRecord,
  matchEmployee,
  rematchEmployee,
  applyVerification,
  parseStaffCsv,
  computeReviewMarkers,
  snapshotRecord,
} = require("./manusonic-logic");

const PORT = Number(process.env.PORT) || 3001;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const COST_CENTRES = {
  "Administration & Support": "5000",
  "Human Resources": "5100",
  "Volunteer Services": "5400",
  "Community Services": "6100",
  "Programs & Outreach": "6900",
  "Food Services": "7200",
  "Shelters & Housing": "7800",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function genRequestId(num) {
  return `LRF-2026-${String(num).padStart(3, "0")}`;
}

function sessionUser(store) {
  return store.employees.find((e) => e.id === store.session?.empId);
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
    if (!parsed.version || parsed.version < 6 || !Array.isArray(parsed.employees)) {
      return applySeed();
    }
    if (!parsed.seeded || !parsed.employees.length) return applySeed();
    parsed.employees = parsed.employees || [];
    parsed.requests = parsed.requests || [];
    parsed.staffImports = parsed.staffImports || [];
    const portalUser = parsed.employees.find((e) => canAccessPortal(e));
    parsed.session = { empId: null, interface: "employee" };
    return parsed;
  } catch {
    return applySeed();
  }
}

function writeStore(store) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/** DEMO ONLY — disable before production deployment. */
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
    appName: store.appName || "Hope Mission LRF",
    seeded: !!store.seeded,
    session: store.session,
    employees: store.employees,
    requests: store.requests,
    leaveTypes: LEAVE_CATEGORIES,
    leaveCategories: LEAVE_CATEGORIES,
    employmentTypes: EMPLOYMENT_TYPES,
    shiftLengths: SHIFT_LENGTHS,
    portalRoles: PORTAL_ROLES,
    correctionReasons: CORRECTION_REASONS,
    fttReviewMsg: FTT_REVIEW_MSG,
    noPortalAccessMsg: NO_PORTAL_ACCESS_MSG,
    departments: Object.keys(COST_CENTRES),
    costCentresByDept: COST_CENTRES,
    stats: {
      total: store.requests.length,
      needsReview: store.requests.filter((r) => r.verificationStatus === "needs_review").length,
      verified: store.requests.filter((r) => r.verificationStatus === "verified").length,
      posted: store.requests.filter((r) => r.postedToManusonic).length,
      pending: store.requests.filter((r) => r.status === "pending").length,
    },
  };
}

function resolveInitialStatus(emp, retro) {
  if (retro) return "taken";
  if (emp.skipApproval) return "approved";
  return "pending";
}

function autoApproveMeta(emp) {
  if (!emp.skipApproval) return {};
  const now = new Date().toISOString();
  return {
    managerComment: "Auto-approved — pending Admin verification.",
    approvedById: null,
    approvedByName: "Auto-approved",
    approvedAt: now,
    decidedAt: now,
    skipApproval: true,
  };
}

function sendManagerEmail(store, record) {
  const mgr = store.employees.find((e) => e.id === record.managerId);
  const subject = `New Leave Request — ${record.empName} — ${record.payPeriodLabel}`;
  const body = [
    subject,
    `Employee: ${record.empName} (${record.empId})`,
    `Pay period: ${record.payPeriodLabel}`,
    `Days: ${record.dayLabels || record.days}`,
    `Total hours: ${record.totalHours}`,
    `Categories: ${(record.hourDistribution || []).map((h) => `${h.hours}h ${h.type}`).join(", ")}`,
    `Notes: ${record.additionalNotes || record.reason || ""}`,
  ].join("\n");
  console.log(`[EMAIL to ${mgr?.email || record.managerName}] ${subject}\n${body}`);
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
        service: "hope-mission-lrf-api",
        appName: store.appName,
        employees: store.employees.length,
        requests: store.requests.length,
        time: new Date().toISOString(),
      });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      return sendJson(res, 200, publicState(readStore()));
    }

    if (req.method === "POST" && pathname === "/api/seed") {
      const store = readStore();
      const user = sessionUser(store);
      if (!isAdminRole(user)) {
        return sendJson(res, 403, { error: "Reset Demo Data is available to Admin only." });
      }
      const seeded = applySeed();
      return sendJson(res, 200, { message: "Demo data restored.", ...publicState(seeded) });
    }

    if (req.method === "PUT" && pathname === "/api/session") {
      const body = await readBody(req);
      const store = readStore();
      if (body.empId) {
        const emp = store.employees.find((e) => e.id === body.empId);
        if (!emp) return sendJson(res, 400, { error: "Employee not found." });
        if (!canAccessPortal(emp)) return sendJson(res, 403, { error: NO_PORTAL_ACCESS_MSG });
        store.session.empId = body.empId;
      }
      if (body.interface) store.session.interface = body.interface;
      writeStore(store);
      return sendJson(res, 200, store.session);
    }

    if (req.method === "POST" && pathname === "/api/submissions/microsoft-forms") {
      const body = await readBody(req);
      const required = ["formResponseId", "name", "employeeId", "shiftLength", "payPeriod", "days"];
      const missing = required.filter((k) => body[k] == null || String(body[k]).trim() === "");
      if (missing.length) {
        return sendJson(res, 400, { error: `Missing required fields: ${missing.join(", ")}` });
      }

      const store = readStore();
      const match = matchEmployee(store, body.employeeId, body.name);
      const record = buildMsFormRecord(body, store, match);

      if (store.requests.some((r) => r.formResponseId === record.formResponseId)) {
        return sendJson(res, 400, { error: "Form response already received." });
      }

      if (!record.shiftLength || !SHIFT_LENGTHS.includes(record.shiftLength)) {
        record.reviewMarkers = computeReviewMarkers(record, match.employee, match.employee);
      }

      store.requests.unshift(record);
      writeStore(store);

      if (!match.employee?.skipApproval) sendManagerEmail(store, record);

      return sendJson(res, 200, { id: record.id, message: "Submission received.", record });
    }

    if (req.method === "POST" && pathname === "/api/staff/import") {
      const body = await readBody(req);
      const store = readStore();
      const user = sessionUser(store);
      if (!isAdminRole(user)) return sendJson(res, 403, { error: "Admin only." });

      const csv = String(body.csv || body.content || "").trim();
      if (!csv) return sendJson(res, 400, { error: "CSV content required." });

      const rows = parseStaffCsv(csv);
      let updated = 0;
      let added = 0;
      const seenIds = new Set(rows.map((r) => r.id));

      rows.forEach((row) => {
        let emp = store.employees.find((e) => e.id === row.id);
        if (emp) {
          emp.name = row.name || emp.name;
          emp.jobRole = row.jobRole || emp.jobRole;
          emp.department = row.department || emp.department;
          emp.costCentre = row.costCentre || emp.costCentre;
          emp.active = true;
          emp.initials = (row.name || emp.name).split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
          updated += 1;
        } else {
          store.employees.push({
            id: row.id,
            name: row.name,
            email: "",
            initials: (row.name || "??").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase(),
            department: row.department,
            costCentre: row.costCentre,
            jobRole: row.jobRole,
            managerId: null,
            managerName: null,
            systemRole: null,
            employmentType: "",
            needsEmploymentType: true,
            skipApproval: false,
            active: true,
            employmentTypeHistory: [],
          });
          added += 1;
        }
      });

      let inactive = 0;
      store.employees.forEach((e) => {
        if (!seenIds.has(e.id) && e.active !== false) {
          e.active = false;
          inactive += 1;
        }
      });

      store.staffImports = store.staffImports || [];
      store.staffImports.unshift({
        date: new Date().toISOString(),
        uploadedBy: user.name,
        uploadedById: user.id,
        updated,
        added,
        inactive,
      });

      writeStore(store);
      return sendJson(res, 200, {
        message: `${updated} records updated, ${added} records added, ${inactive} records marked inactive`,
        updated,
        added,
        inactive,
      });
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/employees/")) {
      const id = decodeURIComponent(pathname.slice("/api/employees/".length));
      const body = await readBody(req);
      const store = readStore();
      const user = sessionUser(store);
      const emp = store.employees.find((e) => e.id === id);
      if (!emp) return sendJson(res, 404, { error: "Employee not found." });

      if (body.employmentType) {
        if (!isAdminRole(user)) return sendJson(res, 403, { error: "Admin only." });
        if (!EMPLOYMENT_TYPES.includes(body.employmentType)) {
          return sendJson(res, 400, { error: "Invalid employment type." });
        }
        if (emp.employmentType && emp.employmentType !== body.employmentType) {
          emp.employmentTypeHistory = emp.employmentTypeHistory || [];
          emp.employmentTypeHistory.unshift({
            previousType: emp.employmentType,
            newType: body.employmentType,
            changedAt: new Date().toISOString(),
            changedBy: user?.name || "Admin",
            changedById: user?.id,
          });
        }
        emp.employmentType = body.employmentType;
        emp.needsEmploymentType = false;
      }
      writeStore(store);
      return sendJson(res, 200, emp);
    }

    const postMatch = pathname.match(/^\/api\/requests\/([^/]+)\/post-to-manusonic$/);
    if (req.method === "PATCH" && postMatch) {
      const store = readStore();
      const user = sessionUser(store);
      if (!isAdminRole(user)) return sendJson(res, 403, { error: "Admin only." });

      const id = decodeURIComponent(postMatch[1]);
      const item = store.requests.find((r) => r.id === id);
      if (!item) return sendJson(res, 404, { error: "Request not found." });
      if (item.postedToManusonic) {
        return sendJson(res, 400, { error: "This record has already been posted to Manusonic and cannot be modified." });
      }
      if (item.verificationStatus !== "verified") {
        return sendJson(res, 400, { error: "Record must be verified before posting." });
      }

      item.postedToManusonic = true;
      item.postedAt = new Date().toISOString();
      item.postedBy = user.name;
      item.verificationStatus = "posted";
      writeStore(store);
      return sendJson(res, 200, item);
    }

    const verifyMatch = pathname.match(/^\/api\/requests\/([^/]+)\/verify$/);
    if (req.method === "PATCH" && verifyMatch) {
      const body = await readBody(req);
      const store = readStore();
      const user = sessionUser(store);
      if (!isAdminRole(user)) return sendJson(res, 403, { error: "Admin only." });

      const id = decodeURIComponent(verifyMatch[1]);
      const item = store.requests.find((r) => r.id === id);
      if (!item) return sendJson(res, 404, { error: "Request not found." });
      if (item.verificationStatus !== "needs_review") {
        return sendJson(res, 400, { error: "Record is not in Needs Review." });
      }

      try {
        if (!body.verifyWithoutChanges && body.corrected?.empId) {
          const rematched = rematchEmployee(store, body.corrected.empId);
          if (rematched) Object.assign(body.corrected, rematched);
        }
        applyVerification(item, body, user);
        item.reviewMarkers = [];
        writeStore(store);
        return sendJson(res, 200, item);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/requests") {
      const body = await readBody(req);
      const store = readStore();
      const emp = store.employees.find((e) => e.id === body.empId);
      if (!emp) return sendJson(res, 400, { error: "Employee not found." });

      const reason = String(body.reason || "").trim();
      if (!reason) return sendJson(res, 400, { error: "reason is required." });

      const shiftLength = String(body.shiftLength || "").trim();
      if (!SHIFT_LENGTHS.includes(shiftLength)) {
        return sendJson(res, 400, { error: "Shift length is required (8 Hours, 10 Hours, or 12 Hours)." });
      }

      let leaveDates = Array.isArray(body.leaveDates)
        ? body.leaveDates.map((d) => String(d).trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        : [];
      leaveDates = [...new Set(leaveDates)].sort();

      const hourDistribution = Array.isArray(body.hourDistribution)
        ? body.hourDistribution.map((row) => ({ type: String(row.type || "").trim(), hours: Number(row.hours) }))
            .filter((row) => row.type && row.hours > 0)
        : [];

      const payPeriod = body.payPeriod || {};
      const payPeriodLabel = String(body.payPeriodLabel || payPeriod.label || "").trim() || null;

      if (!leaveDates.length && body.startDate) {
        leaveDates = [String(body.startDate).trim()];
      }
      if (!leaveDates.length) return sendJson(res, 400, { error: "At least one intended leave date is required." });
      if (!payPeriodLabel && !payPeriod.start) return sendJson(res, 400, { error: "Pay period is required." });
      if (!hourDistribution.length) return sendJson(res, 400, { error: "Hour distribution by leave type is required." });

      const totalHours = Number(body.totalHours) > 0 ? Number(body.totalHours) : hourDistribution.reduce((s, r) => s + r.hours, 0);
      const distSum = hourDistribution.reduce((s, r) => s + r.hours, 0);
      if (Math.abs(totalHours - distSum) > 0.01) {
        return sendJson(res, 400, { error: `Total hours (${totalHours}) must match distribution (${distSum}).` });
      }

      const { fttReviewFlag, payStatus } = evaluateLeaveSubmission(emp, hourDistribution);
      const retro = Boolean(body.retroactive);
      const status = resolveInitialStatus(emp, retro);

      const reqRecord = {
        id: genRequestId(store.nextRequestNum++),
        source: "portal",
        empId: emp.id,
        empName: emp.name,
        initials: emp.initials,
        jobTitle: emp.jobRole,
        department: emp.department,
        costCentre: emp.costCentre,
        managerId: emp.managerId,
        managerName: emp.managerName,
        employmentType: emp.employmentType || "RFT Salaried",
        leaveType: summarizeLeaveTypes(hourDistribution),
        leaveDates,
        dayLabels: leaveDates.join(", "),
        payPeriod: payPeriod.start ? { start: payPeriod.start, end: payPeriod.end, label: payPeriodLabel } : { label: payPeriodLabel },
        payPeriodLabel,
        yearOfLeave: String(body.yearOfLeave || new Date().getFullYear()),
        hourDistribution,
        totalHours,
        shiftLength,
        reason,
        additionalNotes: reason,
        startDate: leaveDates[0],
        endDate: leaveDates[leaveDates.length - 1],
        days: Number(body.days) > 0 ? Number(body.days) : leaveDates.length,
        hours: totalHours,
        status,
        verificationStatus: "needs_review",
        payStatus,
        fttReviewFlag,
        postedToManusonic: false,
        postedAt: null,
        postedBy: null,
        proxySubmission: false,
        correctionsMade: false,
        submittedAt: new Date().toISOString(),
        originalSubmittedAt: new Date().toISOString(),
        managerComment: null,
        auditTrail: [],
        ...autoApproveMeta(emp),
      };

      reqRecord.originalSubmission = snapshotRecord({
        empId: reqRecord.empId,
        empName: reqRecord.empName,
        jobTitle: reqRecord.jobTitle,
        department: reqRecord.department,
        costCentre: reqRecord.costCentre,
        employmentType: reqRecord.employmentType,
        payPeriodLabel: reqRecord.payPeriodLabel,
        yearOfLeave: reqRecord.yearOfLeave,
        days: reqRecord.days,
        dayLabels: reqRecord.dayLabels,
        shiftLength: reqRecord.shiftLength,
        hourDistribution: reqRecord.hourDistribution,
        totalHours: reqRecord.totalHours,
        additionalNotes: reqRecord.additionalNotes,
        submittedAt: reqRecord.submittedAt,
      });
      reqRecord.reviewMarkers = computeReviewMarkers(reqRecord, emp, emp);

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
      if (item.postedToManusonic) {
        return sendJson(res, 400, { error: "This record has already been posted to Manusonic and cannot be modified." });
      }

      if (body.status === "approved" || body.status === "rejected") {
        const approver = sessionUser(store);
        item.status = body.status === "approved" ? "approved" : "rejected";
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

    if (req.method === "GET" && pathname === "/api/leaves") {
      const store = readStore();
      const flat = store.requests
        .filter((r) => r.verificationStatus === "verified" || r.postedToManusonic)
        .map((r) => ({
          id: r.id,
          fullName: r.empName,
          role: r.jobTitle,
          group: r.department,
          date: r.startDate,
          status: r.postedToManusonic ? "posted" : r.status,
          costCentre: r.costCentre,
          hours: r.hours,
          leaveCategory: r.leaveType,
          shiftLength: r.shiftLength,
          payPeriod: r.payPeriodLabel,
          employeeType: r.employmentType,
          proxySubmission: r.proxySubmission,
          correctionsMade: r.correctionsMade,
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
  console.log(`Hope Mission LRF: http://localhost:${PORT}`);
  console.log(`Records: ${store.requests.length} requests, ${store.employees.length} employees`);
});
