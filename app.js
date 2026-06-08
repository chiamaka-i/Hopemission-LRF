/**
 * Hope Mission LRF — frontend
 * Communicates with backend via /api/state, /api/requests, /api/session, /api/health
 */

const API_BASE = (typeof window !== "undefined" && window.HOPEMISSION_API != null
  ? String(window.HOPEMISSION_API)
  : ""
).replace(/\/$/, "");

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── State ──────────────────────────────────────────────────────
let state = {
  employees: [],
  requests: [],
  session: { empId: null, interface: "employee" },
  leaveTypes: [],
  employmentTypes: [],
  shiftLengths: [],
  portalRoles: ["manager", "admin", "hr"],
  fttReviewMsg: "",
  noPortalAccessMsg: "",
  correctionReasons: [],
  costCentresByDept: {},
  stats: {},
  seeded: false,
};
let apiConnected = false;
let currentSection = null;

// kept for compatibility — elements no longer exist but logic is harmless
let adminFilters = { department: "", costCentre: "", approvedBy: "", payPeriod: "" };
let snapshotPayPeriod = "";

// ── Sidebar nav config ─────────────────────────────────────────
const SECTION_NAV = {
  manager: [
    { id: "s-mgr-queue",   label: "Approval Queue",  icon: `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>` },
    { id: "s-emp-submit",  label: "Submit My Leave", icon: `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>` },
    { id: "s-emp-history", label: "My Requests",     icon: `<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>` },
  ],
  admin: [
    { id: "s-admin-manusonic", label: "Manusonic Entry", icon: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>` },
    { id: "s-admin-requests",  label: "Leave Requests",  icon: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>` },
    { id: "s-admin-snapshot",  label: "Leave Snapshot",  icon: `<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>` },
    { id: "s-admin-reports",   label: "Reports",         icon: `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>` },
    { id: "s-admin-directory", label: "Staff Directory", icon: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>` },
  ],
  hr: [
    { id: "s-admin-requests",  label: "Leave Requests",  icon: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>` },
    { id: "s-admin-snapshot",  label: "Leave Snapshot",  icon: `<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>` },
    { id: "s-admin-reports",   label: "Reports",         icon: `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>` },
    { id: "s-admin-directory", label: "Staff Directory", icon: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>` },
    { id: "s-admin-manusonic", label: "Manusonic Entry", icon: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>` },
  ],
};

// ── API ────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch { /* ignore */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Utilities ──────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show toast--${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 4500);
}

function canAccessPortal(emp) {
  return emp && state.portalRoles.includes(emp.systemRole);
}

function currentEmployee() {
  return state.employees.find((e) => e.id === state.session.empId) || null;
}

function categoriesForEmployee(emp) {
  const employmentType = emp?.employmentType || "RFT Salaried";
  if (employmentType === "RFT Hourly") {
    return state.leaveTypes.filter((c) => c !== "Vacation" && c !== "OT Banked");
  }
  return [...state.leaveTypes];
}

function badge(status) {
  const label = status === "manusonic_queue" ? "Manusonic queue" : status;
  const cls = status === "pending" ? "badge--pending"
    : status === "rejected" ? "badge--rejected" : "badge--approved";
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function payPeriodForDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput + "T12:00:00");
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < 21) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  const start = new Date(y, m, 21);
  const end = new Date(y, m + 1, 20);
  const label = `${MONTHS_FULL[start.getMonth()]} 21 – ${MONTHS_FULL[end.getMonth()]} 20`;
  return { start: toISO(start), end: toISO(end), label, value: `${toISO(start)}_${toISO(end)}` };
}

function buildPayPeriodOptions() {
  const seen = new Set();
  const options = [];
  const now = new Date();
  for (let offset = -8; offset <= 8; offset += 1) {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 15);
    const p = payPeriodForDate(ref);
    if (seen.has(p.value)) continue;
    seen.add(p.value);
    options.push(p);
  }
  state.requests.forEach((r) => {
    const v = r.payPeriod?.start && r.payPeriod?.end
      ? `${r.payPeriod.start}_${r.payPeriod.end}` : null;
    if (v && r.payPeriodLabel && !seen.has(v)) {
      seen.add(v);
      options.push({ start: r.payPeriod.start, end: r.payPeriod.end, label: r.payPeriodLabel, value: v });
    }
  });
  return options.sort((a, b) => a.start.localeCompare(b.start));
}

function parseLeaveDates(text) {
  const raw = String(text || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid = [], bad = [];
  raw.forEach((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { bad.push(s); return; }
    const d = new Date(s + "T12:00:00");
    if (isNaN(d)) bad.push(s); else valid.push(s);
  });
  return { valid: [...new Set(valid)].sort(), bad };
}

function formatDistribution(r) {
  const lines = r.hourDistribution || [];
  if (lines.length) return lines.map((x) => `${x.hours}h ${x.type}`).join(" · ");
  return r.leaveType || "—";
}

function formatLeaveDates(r) {
  if (r.leaveDates?.length) return r.leaveDates.join(", ");
  if (r.startDate && r.endDate && r.startDate !== r.endDate) return `${r.startDate} – ${r.endDate}`;
  return r.startDate || "—";
}

function requestPayPeriodValue(r) {
  if (r.payPeriod?.start && r.payPeriod?.end) return `${r.payPeriod.start}_${r.payPeriod.end}`;
  return "";
}

function requestCard(r, actionsHtml = "") {
  const hours = r.totalHours ?? r.hours ?? 0;
  const payPeriod = r.payPeriodLabel || r.payPeriod?.label || "—";
  const shiftLength = r.shiftLength || "—";
  const approver =
    r.approvedByName && (r.status === "manusonic_queue" || r.status === "approved" || r.status === "rejected")
      ? `${r.approvedByName}${r.approvedById ? ` (${r.approvedById})` : ""}`
      : r.status === "pending" ? "— pending"
      : r.status === "taken" ? "— retroactive (no approval)" : "—";
  const fttFlag = r.fttReviewFlag
    ? `<div class="flag-ftt">${esc(state.fttReviewMsg || "FTT staff submitted paid leave categories — please review before posting to Manusonic")}</div>`
    : "";
  return `<li class="item">
    <div class="av">${esc(r.initials)}</div>
    <div class="item-body">
      <div class="item-top">
        <strong>${esc(r.empName)} <span class="text-muted">(${esc(r.empId)})</span> · ${esc(r.leaveType)}</strong>
        ${badge(r.status)}
      </div>
      <div class="meta"><strong>Dept:</strong> ${esc(r.department)} · <strong>CC:</strong> ${esc(r.costCentre)}</div>
      <div class="meta"><strong>Pay period:</strong> ${esc(payPeriod)}</div>
      <div class="meta"><strong>Shift length:</strong> ${esc(shiftLength)}</div>
      <div class="meta"><strong>Dates:</strong> ${esc(formatLeaveDates(r))}</div>
      <div class="meta"><strong>Hours:</strong> ${hours}h total — ${esc(formatDistribution(r))}</div>
      <div class="meta"><strong>Approved by:</strong> ${esc(approver)}</div>
      <div class="meta">${esc(r.reason)}</div>
      ${r.managerComment ? `<div class="meta">Comment: ${esc(r.managerComment)}</div>` : ""}
      ${fttFlag}
    </div>
    ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ""}
  </li>`;
}

function countWeekdaysFromDates(dates) {
  let n = 0;
  dates.forEach((iso) => {
    const d = new Date(iso + "T12:00:00");
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) n += 1;
  });
  return n || dates.length;
}

// ── Data ───────────────────────────────────────────────────────
async function loadState() {
  const health = await api("/api/health");
  apiConnected = !!health.ok;
  const data = await api("/api/state");
  state = { ...state, ...data };
  if (!state.leaveTypes?.length && state.leaveCategories?.length) {
    state.leaveTypes = state.leaveCategories;
  }
  return data;
}

function saveSession(empId, iface) {
  state.session = { empId, interface: iface };
}

// ── Screen management ──────────────────────────────────────────
function showSignInScreen() {
  const si = document.getElementById("screen-signin");
  const app = document.getElementById("screen-app");
  if (si) { si.hidden = false; si.classList.add("active"); }
  if (app) { app.hidden = true; app.classList.remove("active"); }
  document.getElementById("access-denied")?.classList.remove("show");
}

function showAppScreen(emp) {
  const si = document.getElementById("screen-signin");
  const app = document.getElementById("screen-app");
  if (si) { si.hidden = true; si.classList.remove("active"); }
  if (app) { app.hidden = false; app.classList.add("active"); }
  buildSidebar(emp);
  const navItems = SECTION_NAV[emp.systemRole] || SECTION_NAV.manager;
  navigate(navItems[0].id);
}

// ── Navigation ─────────────────────────────────────────────────
function navigate(sectionId) {
  document.querySelectorAll(".app-section").forEach((s) => s.classList.remove("active"));
  document.getElementById(sectionId)?.classList.add("active");
  document.querySelectorAll(".sidebar-nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === sectionId);
  });
  currentSection = sectionId;
  renderCurrentSection();
}

function renderCurrentSection() {
  if (!currentSection) return;
  switch (currentSection) {
    case "s-emp-submit":
    case "s-emp-history":
      renderEmployee();
      break;
    case "s-mgr-queue":
      renderManager();
      break;
    case "s-admin-manusonic":
      if (window.ManusonicUI) window.ManusonicUI.renderManusonic(state);
      break;
    case "s-admin-requests":
    case "s-admin-snapshot":
    case "s-admin-reports":
      if (window.ManusonicUI) window.ManusonicUI.renderHrSection(state, currentSection);
      break;
    case "s-admin-directory":
      renderAdminEmployees();
      break;
  }
}

// ── Sidebar ────────────────────────────────────────────────────
function buildSidebar(emp) {
  const nav = document.getElementById("sidebar-nav");
  if (!nav) return;
  const items = SECTION_NAV[emp.systemRole] || SECTION_NAV.manager;
  nav.innerHTML = items.map((item) =>
    `<button type="button" class="sidebar-nav-item" data-section="${esc(item.id)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${item.icon}</svg>
      ${esc(item.label)}
    </button>`
  ).join("");
  nav.querySelectorAll(".sidebar-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeSidebarMobile();
      navigate(btn.dataset.section);
    });
  });
  const userInfo = document.getElementById("sidebar-user");
  if (userInfo) {
    const roleLabel = { manager: "Manager", admin: "Admin", hr: "HR" }[emp.systemRole] || "Staff";
    userInfo.innerHTML =
      `<span class="sidebar-user-name">${esc(emp.name)}</span>
       <span class="sidebar-user-role">${esc(roleLabel)} · ${esc(emp.department)}</span>`;
  }
}

function toggleSidebarMobile() {
  document.getElementById("sidebar")?.classList.toggle("open");
  document.getElementById("sidebar-backdrop")?.classList.toggle("show");
}

function closeSidebarMobile() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("show");
}

function logout() {
  state.session = { empId: null, interface: "employee" };
  currentSection = null;
  fillSignInUserSelect();
  showSignInScreen();
}

// ── Fill helpers ───────────────────────────────────────────────
function fillSignInUserSelect() {
  const sel = document.getElementById("signin-user");
  if (!sel) return;
  const portalUsers = state.employees.filter((e) => canAccessPortal(e));
  const directoryOnly = state.employees.filter((e) => !canAccessPortal(e));
  const portalHtml = portalUsers.map((e) => {
    const roleLabel = e.systemRole === "manager" ? "Manager" : e.systemRole === "hr" ? "HR" : "Admin";
    return `<option value="${esc(e.id)}">${esc(e.id)} — ${esc(e.name)} (${roleLabel})</option>`;
  }).join("");
  const dirHtml = directoryOnly.map((e) =>
    `<option value="${esc(e.id)}">${esc(e.id)} — ${esc(e.name)} (directory only)</option>`
  ).join("");
  sel.innerHTML =
    `<option value="">— Select your name —</option>` +
    (portalHtml ? `<optgroup label="Portal access">${portalHtml}</optgroup>` : "") +
    (dirHtml ? `<optgroup label="Directory only — cannot sign in">${dirHtml}</optgroup>` : "");
}

function fillPayPeriodSelect() {
  const sel = document.getElementById("emp-pay-period");
  if (!sel) return;
  const periods = buildPayPeriodOptions();
  const current = payPeriodForDate(new Date());
  sel.innerHTML = periods.map((p) =>
    `<option value="${esc(p.value)}" data-start="${esc(p.start)}" data-end="${esc(p.end)}" data-label="${esc(p.label)}"${p.value === current.value ? " selected" : ""}>${esc(p.label)}</option>`
  ).join("");
}

// ── Distribution rows ──────────────────────────────────────────
function leaveTypeOptionsHtml(selected, emp) {
  const types = emp ? categoriesForEmployee(emp) : state.leaveTypes;
  return types.map((t) =>
    `<option value="${esc(t)}"${t === selected ? " selected" : ""}>${esc(t)}</option>`
  ).join("");
}

function createDistRow(type = "Paid Sick Leave", hours = "") {
  const emp = currentEmployee();
  const row = document.createElement("div");
  row.className = "dist-row";
  row.innerHTML = `
    <select class="dist-type" aria-label="Leave type">${leaveTypeOptionsHtml(type, emp)}</select>
    <input class="dist-hours" type="number" min="0" step="0.5" placeholder="Hrs" value="${hours === "" ? "" : esc(hours)}" aria-label="Hours" />
    <button type="button" class="btn-remove" title="Remove line" aria-label="Remove line">×</button>`;
  row.querySelector(".dist-hours")?.addEventListener("input", syncDistributionTotal);
  row.querySelector(".btn-remove")?.addEventListener("click", () => {
    const list = document.getElementById("hour-dist-list");
    if (list && list.children.length > 1) { row.remove(); syncDistributionTotal(); }
  });
  return row;
}

function initDistributionRows() {
  const list = document.getElementById("hour-dist-list");
  if (!list) return;
  list.innerHTML = "";
  list.appendChild(createDistRow("Paid Sick Leave", ""));
  syncDistributionTotal();
}

function refreshDistributionOptions() {
  const emp = currentEmployee();
  document.querySelectorAll("#hour-dist-list .dist-type").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = leaveTypeOptionsHtml(current, emp);
  });
}

function readHourDistribution() {
  const rows = document.querySelectorAll("#hour-dist-list .dist-row");
  const out = [];
  rows.forEach((row) => {
    const type = row.querySelector(".dist-type")?.value;
    const hours = parseFloat(row.querySelector(".dist-hours")?.value, 10);
    if (type && hours > 0) out.push({ type, hours });
  });
  return out;
}

function syncDistributionTotal() {
  const sum = readHourDistribution().reduce((s, x) => s + x.hours, 0);
  const sumEl = document.getElementById("dist-sum");
  const totalInput = document.getElementById("emp-total-hours");
  if (sumEl) sumEl.textContent = String(sum);
  if (totalInput && !totalInput.dataset.manual) {
    totalInput.value = sum > 0 ? String(sum) : "";
  }
}

// ── Render functions ───────────────────────────────────────────
function renderEmployee() {
  const emp = currentEmployee();
  const label = document.getElementById("emp-user-label");
  if (label) label.textContent = emp ? `${emp.name} (${emp.id}) · ${emp.department}` : "—";
  refreshDistributionOptions();
  const list = document.getElementById("emp-list");
  if (!list || !emp) return;
  const mine = state.requests.filter((r) => r.empId === emp.id);
  if (!mine.length) {
    list.innerHTML = '<li class="empty">No leave requests yet. Submit one using the form.</li>';
    return;
  }
  list.innerHTML = mine.map((r) => requestCard(r)).join("");
}

function renderManager() {
  const emp = currentEmployee();
  const label = document.getElementById("mgr-user-label");
  if (label) label.textContent = emp ? emp.name : "—";
  const list = document.getElementById("mgr-list");
  if (!list || !emp) return;
  const queue = state.requests.filter(
    (r) => r.managerId === emp.id && r.status === "pending" && r.empId !== emp.id
  );
  if (!queue.length) {
    list.innerHTML = '<li class="empty">No pending approvals in your queue.</li>';
    return;
  }
  list.innerHTML = queue.map((r) =>
    requestCard(r,
      `<button type="button" class="btn btn--ok btn--sm" data-approve="${esc(r.id)}">Approve</button>
       <button type="button" class="btn btn--no btn--sm" data-reject="${esc(r.id)}">Reject</button>`)
  ).join("");
  list.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.dataset.approve, "approved"));
  });
  list.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.dataset.reject, "rejected"));
  });
}

async function updateEmploymentType(empId, employmentType) {
  try {
    await api(`/api/employees/${encodeURIComponent(empId)}`, {
      method: "PATCH",
      body: JSON.stringify({ employmentType }),
    });
    await loadState();
    renderAll();
    showToast(`Employment type updated for ${empId}.`, "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderAdminEmployees() {
  const list = document.getElementById("admin-employees");
  if (!list) return;
  const types = state.employmentTypes.length ? state.employmentTypes : ["RFT Salaried", "RFT Hourly", "FTT"];
  const admin = window.ManusonicUI?.isAdmin(state);
  list.innerHTML = state.employees.map((e) => {
    const portal = canAccessPortal(e);
    const roleLabel = portal
      ? e.systemRole === "manager" ? "Manager" : e.systemRole === "hr" ? "HR" : "Admin"
      : "Directory only (no portal access)";
    const inactive = e.active === false ? " · Inactive" : "";
    const needsType = e.needsEmploymentType
      ? ` · <span class='attention-marker' style='display:inline;padding:0.1rem 0.35rem'>Set employment type</span>`
      : "";
    const typeField = admin
      ? `<select class="emp-type-select" data-emp-type="${esc(e.id)}">${types.map((t) =>
          `<option value="${esc(t)}"${t === e.employmentType ? " selected" : ""}>${esc(t)}</option>`
        ).join("")}<option value=""${!e.employmentType ? " selected" : ""}>— unset —</option></select>`
      : esc(e.employmentType || "—");
    const history = (e.employmentTypeHistory || []).length
      ? `<details class="status-history"><summary>Status History (${e.employmentTypeHistory.length})</summary>${e.employmentTypeHistory.map((h) =>
          `<div class="meta">${esc(h.previousType || "—")} → ${esc(h.newType)} · ${esc(h.changedBy)} · ${esc(new Date(h.changedAt).toLocaleString())}</div>`
        ).join("")}</details>`
      : "";
    return `<li class="item">
      <div class="av">${esc(e.initials)}</div>
      <div class="item-body">
        <div class="item-top"><strong>${esc(e.id)} · ${esc(e.name)}</strong>${inactive ? `<span class="badge badge--pending">Inactive</span>` : ""}</div>
        <div class="meta">${esc(e.jobRole)} · ${esc(e.department)} · CC ${esc(e.costCentre)}</div>
        <div class="meta">Portal: ${esc(roleLabel)}</div>
        <div class="meta">Manager: ${esc(e.managerName || "—")}${e.managerId ? ` (${esc(e.managerId)})` : ""}</div>
        <div class="meta">Employment type: ${typeField}${needsType}</div>
        ${history}
      </div>
    </li>`;
  }).join("");
  if (admin) {
    list.querySelectorAll("[data-emp-type]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const v = ev.target.value;
        if (v) updateEmploymentType(ev.target.dataset.empType, v);
      });
    });
  }
}

function renderAll() {
  fillSignInUserSelect();
  fillPayPeriodSelect();
  if (window.ManusonicUI) window.ManusonicUI.fillHrFilterOptions(state);
  renderCurrentSection();
}

// ── Actions ────────────────────────────────────────────────────
async function decide(id, status) {
  try {
    await api(`/api/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        managerComment: status === "approved"
          ? "Approved — sent to Manusonic Entry Queue."
          : "Rejected.",
      }),
    });
    await loadState();
    renderAll();
    showToast(
      status === "approved"
        ? "Approved — pending Admin verification in Manusonic Entry."
        : "Request rejected.",
      "success"
    );
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function submitEmployeeForm(e) {
  e.preventDefault();
  const emp = currentEmployee();
  if (!emp) return showToast("No employee selected.", "error");
  const { valid: leaveDates, bad } = parseLeaveDates(document.getElementById("emp-leave-dates")?.value);
  const paySel = document.getElementById("emp-pay-period");
  const shiftLength = document.getElementById("emp-shift-length")?.value || "";
  const reason = document.getElementById("emp-reason")?.value.trim() || "";
  const retro = document.getElementById("emp-retro")?.checked;
  const hourDistribution = readHourDistribution();
  const totalHours = parseFloat(document.getElementById("emp-total-hours")?.value, 10);
  const distSum = hourDistribution.reduce((s, x) => s + x.hours, 0);
  if (bad.length) return showToast(`Invalid date(s): ${bad.join(", ")}`, "error");
  if (!leaveDates.length) return showToast("Add at least one intended leave date.", "error");
  if (!paySel?.value) return showToast("Select a pay period.", "error");
  if (!state.shiftLengths.includes(shiftLength) && !["8 Hours", "10 Hours", "12 Hours"].includes(shiftLength)) {
    return showToast("Select a shift length (8 Hours, 10 Hours, or 12 Hours).", "error");
  }
  if (!hourDistribution.length) return showToast("Add at least one leave type with hours.", "error");
  if (!reason) return showToast("Please enter a reason.", "error");
  if (!(totalHours > 0)) return showToast("Enter total hours.", "error");
  if (Math.abs(totalHours - distSum) > 0.01) {
    return showToast(`Total hours (${totalHours}) must match distribution sum (${distSum}).`, "error");
  }
  const allowed = new Set(categoriesForEmployee(emp));
  const disallowed = hourDistribution.filter((row) => !allowed.has(row.type));
  if (disallowed.length) {
    return showToast(
      `${emp.employmentType || "RFT Salaried"} staff cannot use: ${disallowed.map((r) => r.type).join(", ")}`,
      "error"
    );
  }
  const payPeriod = {
    start: paySel.selectedOptions[0]?.dataset.start,
    end: paySel.selectedOptions[0]?.dataset.end,
    label: paySel.selectedOptions[0]?.dataset.label || paySel.selectedOptions[0]?.textContent,
  };
  const startDate = leaveDates[0];
  const endDate = leaveDates[leaveDates.length - 1];
  const days = countWeekdaysFromDates(leaveDates);
  const leaveType = hourDistribution.length === 1
    ? hourDistribution[0].type
    : [...new Set(hourDistribution.map((h) => h.type))].join(" · ");
  try {
    const created = await api("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        empId: emp.id, leaveDates, payPeriod, payPeriodLabel: payPeriod.label,
        hourDistribution, totalHours, shiftLength, leaveType, reason,
        startDate, endDate, days, hours: totalHours, retroactive: retro,
      }),
    });
    await loadState();
    renderAll();
    const form = document.getElementById("form-employee");
    form?.reset();
    const totalEl = document.getElementById("emp-total-hours");
    if (totalEl) delete totalEl.dataset.manual;
    initDistributionRows();
    fillPayPeriodSelect();
    if (created.fttReviewFlag) {
      showToast(state.fttReviewMsg || "FTT review flag set on submission.", "info");
    } else {
      showToast("Leave request submitted — pending Admin review in Manusonic Entry.", "success");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

function handleMsSignIn() {
  showToast("Microsoft 365 sign-in will be available soon.", "info");
}

function defaultInterfaceForRole(role) {
  if (role === "manager") return "manager";
  if (role === "admin") return "manusonic";
  if (role === "hr") return "admin";
  return "employee";
}

// legacy stubs — no-ops since their elements no longer exist
function fillAdminFilterOptions() {}
function getFilteredAdminRequests() { return []; }
function fillPayPeriodFilterSelect() {}

// ── Event wiring ───────────────────────────────────────────────
function wireSignIn() {
  document.getElementById("btn-ms-signin")?.addEventListener("click", handleMsSignIn);

  document.getElementById("signin-user")?.addEventListener("change", (e) => {
    const empId = e.target.value;
    if (!empId) return;
    const emp = state.employees.find((x) => x.id === empId);
    if (!emp) return;
    const denied = document.getElementById("access-denied");
    if (!canAccessPortal(emp)) {
      if (denied) {
        denied.textContent = state.noPortalAccessMsg ||
          "Your account does not have access to this portal. Please submit leave via the Microsoft Form.";
        denied.classList.add("show");
      }
      return;
    }
    denied?.classList.remove("show");
    const iface = defaultInterfaceForRole(emp.systemRole);
    saveSession(emp.id, iface);
    showAppScreen(emp);
  });
}

function wireApp() {
  document.getElementById("btn-logout")?.addEventListener("click", logout);
  document.getElementById("btn-sidebar-toggle")?.addEventListener("click", toggleSidebarMobile);
  document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebarMobile);
  document.getElementById("form-employee")?.addEventListener("submit", submitEmployeeForm);
  document.getElementById("btn-add-dist")?.addEventListener("click", () => {
    document.getElementById("hour-dist-list")?.appendChild(createDistRow("Personal Day", ""));
    syncDistributionTotal();
  });
  document.getElementById("emp-total-hours")?.addEventListener("input", (e) => {
    e.target.dataset.manual = "1";
  });
  if (window.ManusonicUI) {
    window.ManusonicUI.wire(state, { api, loadState, renderAll, showToast });
  }
}

// ── Init ───────────────────────────────────────────────────────
async function init() {
  initDistributionRows();
  wireSignIn();
  wireApp();

  try {
    await loadState();
    state.session = { empId: null, interface: "employee" };
    fillSignInUserSelect();
    fillPayPeriodSelect();
    if (window.ManusonicUI) window.ManusonicUI.fillHrFilterOptions(state);
  } catch (err) {
    showToast("Unable to load leave data. Ensure the server is running.", "error");
  }
  showSignInScreen();
}

document.addEventListener("DOMContentLoaded", () => init());
