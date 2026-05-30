/**
 * HopeMission LRF Application — frontend
 * Communicates with backend via /api/state, /api/requests, /api/session, /api/health
 */

const API_BASE = (typeof window !== "undefined" && window.HOPEMISSION_API != null
  ? String(window.HOPEMISSION_API)
  : ""
).replace(/\/$/, "");

let state = {
  employees: [],
  requests: [],
  session: { empId: null, interface: "employee" },
  leaveTypes: [],
  stats: {},
  seeded: false,
};
let apiConnected = false;
let adminFilters = { department: "", costCentre: "", approvedBy: "" };

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = JSON.parse(text).error || text;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show toast--${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 4500);
}

function setApiStatus(ok, detail) {
  const el = document.getElementById("api-status");
  const foot = document.getElementById("footer-api");
  if (!el) return;
  el.className = `api-pill ${ok ? "api-pill--ok" : "api-pill--err"}`;
  el.textContent = ok ? `Backend linked · ${detail}` : `Backend offline · ${detail}`;
  if (foot) foot.textContent = ok ? "API connected" : "API offline (demo UI only)";
}

function currentEmployee() {
  return state.employees.find((e) => e.id === state.session.empId) || state.employees[0];
}

function badge(status) {
  const cls =
    status === "pending"
      ? "badge--pending"
      : status === "rejected"
        ? "badge--rejected"
        : "badge--approved";
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Pay period containing a calendar day: 21st → 20th next month. */
function payPeriodForDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput + "T12:00:00");
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() >= 21) {
    /* starts 21st this month */
  } else {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  const start = new Date(y, m, 21);
  const end = new Date(y, m + 1, 20);
  const label = `21 ${MONTHS_SHORT[start.getMonth()]} ${start.getFullYear()} – 20 ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
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
  return options.sort((a, b) => a.start.localeCompare(b.start));
}

function parseLeaveDates(text) {
  const raw = String(text || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = [];
  const bad = [];
  raw.forEach((s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      bad.push(s);
      return;
    }
    const d = new Date(s + "T12:00:00");
    if (isNaN(d)) bad.push(s);
    else valid.push(s);
  });
  return { valid: [...new Set(valid)].sort(), bad };
}

function formatDistribution(r) {
  const lines = r.hourDistribution || [];
  if (lines.length) {
    return lines.map((x) => `${x.hours}h ${x.type}`).join(" · ");
  }
  return r.leaveType || "—";
}

function formatLeaveDates(r) {
  if (r.leaveDates?.length) return r.leaveDates.join(", ");
  if (r.startDate && r.endDate && r.startDate !== r.endDate) {
    return `${r.startDate} – ${r.endDate}`;
  }
  return r.startDate || "—";
}

function requestCard(r, actionsHtml = "") {
  const hours = r.totalHours ?? r.hours ?? 0;
  const payPeriod = r.payPeriodLabel || r.payPeriod?.label || "";
  const approver =
    r.approvedByName && (r.status === "approved" || r.status === "rejected")
      ? `${r.approvedByName} (${r.approvedById})`
      : r.status === "pending"
        ? "— pending"
        : r.status === "taken"
          ? "— retroactive (no approval)"
          : "—";
  return `<li class="item">
    <div class="av">${esc(r.initials)}</div>
    <div class="item-body">
      <div class="item-top">
        <strong>${esc(r.empName)} <span class="text-muted">(${esc(r.empId)})</span> · ${esc(r.leaveType)}</strong>
        ${badge(r.status)}
      </div>
      <div class="meta"><strong>Dept:</strong> ${esc(r.department)} · <strong>CC:</strong> ${esc(r.costCentre)}</div>
      <div class="meta"><strong>Dates:</strong> ${esc(formatLeaveDates(r))}</div>
      ${payPeriod ? `<div class="meta"><strong>Pay period:</strong> ${esc(payPeriod)}</div>` : ""}
      <div class="meta"><strong>Hours:</strong> ${hours}h total — ${esc(formatDistribution(r))}</div>
      <div class="meta"><strong>Approved by:</strong> ${esc(approver)}</div>
      <div class="meta">${esc(r.reason)}</div>
      ${r.managerComment ? `<div class="meta">Comment: ${esc(r.managerComment)}</div>` : ""}
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

async function loadState() {
  const health = await api("/api/health");
  apiConnected = !!health.ok;
  setApiStatus(true, `${health.requests} requests · seeded: ${health.seeded}`);

  const data = await api("/api/state");
  state = { ...state, ...data };
  return data;
}

async function saveSession(empId, iface) {
  state.session = await api("/api/session", {
    method: "PUT",
    body: JSON.stringify({ empId, interface: iface }),
  });
}

function switchInterface(iface) {
  state.session.interface = iface;
  document.querySelectorAll(".iface-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.interface === iface);
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${iface}`);
  });
  renderAll();
}

function fillDemoUserSelect() {
  const sel = document.getElementById("demo-user");
  if (!sel) return;
  sel.innerHTML = state.employees
    .map(
      (e) =>
        `<option value="${esc(e.id)}" data-role="${esc(e.systemRole)}">${esc(e.id)} — ${esc(e.name)} (${esc(e.jobRole)})</option>`
    )
    .join("");
  sel.value = state.session.empId || state.employees[0]?.id || "";
}

function fillPayPeriodSelect() {
  const sel = document.getElementById("emp-pay-period");
  if (!sel) return;
  const periods = buildPayPeriodOptions();
  const current = payPeriodForDate(new Date());
  sel.innerHTML = periods
    .map(
      (p) =>
        `<option value="${esc(p.value)}" data-start="${esc(p.start)}" data-end="${esc(p.end)}" data-label="${esc(p.label)}"${p.value === current.value ? " selected" : ""}>${esc(p.label)}</option>`
    )
    .join("");
}

function leaveTypeOptionsHtml(selected) {
  return state.leaveTypes
    .map((t) => `<option value="${esc(t)}"${t === selected ? " selected" : ""}>${esc(t)}</option>`)
    .join("");
}

function createDistRow(type = "Sick Leave", hours = "") {
  const row = document.createElement("div");
  row.className = "dist-row";
  row.innerHTML = `
    <select class="dist-type" aria-label="Leave type">${leaveTypeOptionsHtml(type)}</select>
    <input class="dist-hours" type="number" min="0" step="0.5" placeholder="Hrs" value="${hours === "" ? "" : esc(hours)}" aria-label="Hours" />
    <button type="button" class="btn-remove" title="Remove line" aria-label="Remove line">×</button>`;
  row.querySelector(".dist-hours")?.addEventListener("input", syncDistributionTotal);
  row.querySelector(".btn-remove")?.addEventListener("click", () => {
    const list = document.getElementById("hour-dist-list");
    if (list && list.children.length > 1) {
      row.remove();
      syncDistributionTotal();
    }
  });
  return row;
}

function initDistributionRows() {
  const list = document.getElementById("hour-dist-list");
  if (!list) return;
  list.innerHTML = "";
  list.appendChild(createDistRow("Sick Leave", ""));
  syncDistributionTotal();
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

function renderEmployee() {
  const emp = currentEmployee();
  const label = document.getElementById("emp-user-label");
  if (label) label.textContent = emp ? `${emp.name} (${emp.id}) · ${emp.department}` : "—";

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

  list.innerHTML = queue
    .map((r) =>
      requestCard(
        r,
        `<button type="button" class="btn btn--ok btn--sm" data-approve="${esc(r.id)}">Approve</button>
         <button type="button" class="btn btn--no btn--sm" data-reject="${esc(r.id)}">Reject</button>`
      )
    )
    .join("");

  list.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.dataset.approve, "approved"));
  });
  list.querySelectorAll("[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn.dataset.reject, "rejected"));
  });
}

function getFilteredAdminRequests() {
  return state.requests.filter((r) => {
    if (adminFilters.department && r.department !== adminFilters.department) return false;
    if (adminFilters.costCentre && r.costCentre !== adminFilters.costCentre) return false;
    if (adminFilters.approvedBy === "__pending__" && r.approvedById) return false;
    if (adminFilters.approvedBy && adminFilters.approvedBy !== "__pending__") {
      if (r.approvedById !== adminFilters.approvedBy) return false;
    }
    return true;
  });
}

function fillAdminFilterOptions() {
  const depts = [...new Set(state.requests.map((r) => r.department))].sort();
  const ccs = [...new Set(state.requests.map((r) => r.costCentre))].sort();
  const approvers = {};
  state.requests.forEach((r) => {
    if (r.approvedById && r.approvedByName) {
      approvers[r.approvedById] = r.approvedByName;
    }
  });
  state.employees
    .filter((e) => e.systemRole === "manager" || e.systemRole === "admin")
    .forEach((e) => {
      approvers[e.id] = e.name;
    });

  const deptSel = document.getElementById("admin-filter-dept");
  const ccSel = document.getElementById("admin-filter-cc");
  const appSel = document.getElementById("admin-filter-approver");

  if (deptSel) {
    const v = deptSel.value;
    deptSel.innerHTML =
      `<option value="">All departments</option>` +
      depts.map((d) => `<option value="${esc(d)}"${d === v ? " selected" : ""}>${esc(d)}</option>`).join("");
  }
  if (ccSel) {
    const v = ccSel.value;
    ccSel.innerHTML =
      `<option value="">All cost centres</option>` +
      ccs.map((c) => `<option value="${esc(c)}"${c === v ? " selected" : ""}>${esc(c)}</option>`).join("");
  }
  if (appSel) {
    const v = appSel.value;
    appSel.innerHTML =
      `<option value="">All approvers</option>` +
      `<option value="__pending__"${v === "__pending__" ? " selected" : ""}>Pending (not yet approved)</option>` +
      Object.entries(approvers)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(
          ([id, name]) =>
            `<option value="${esc(id)}"${id === v ? " selected" : ""}>${esc(name)} (${esc(id)})</option>`
        )
        .join("");
  }
}

function renderAdminEmployees() {
  const list = document.getElementById("admin-employees");
  if (!list) return;
  list.innerHTML = state.employees
    .map(
      (e) => `<li class="item">
      <div class="av">${esc(e.initials)}</div>
      <div class="item-body">
        <div class="item-top"><strong>${esc(e.id)} · ${esc(e.name)}</strong></div>
        <div class="meta">${esc(e.jobRole)} · ${esc(e.department)} · CC ${esc(e.costCentre)}</div>
        <div class="meta">Manager: ${esc(e.managerName || "—")}${e.managerId ? ` (${esc(e.managerId)})` : ""}</div>
      </div>
    </li>`
    )
    .join("");
}

function renderAdmin() {
  fillAdminFilterOptions();
  const filtered = getFilteredAdminRequests();

  const statsEl = document.getElementById("admin-stats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat"><span>Showing</span><strong>${filtered.length}</strong></div>
      <div class="stat"><span>Pending</span><strong>${filtered.filter((r) => r.status === "pending").length}</strong></div>
      <div class="stat"><span>Approved / taken</span><strong>${filtered.filter((r) => r.status === "approved" || r.status === "taken").length}</strong></div>
      <div class="stat"><span>Rejected</span><strong>${filtered.filter((r) => r.status === "rejected").length}</strong></div>
      <div class="stat"><span>Employees</span><strong>${state.employees.length}</strong></div>`;
  }

  const countEl = document.getElementById("admin-filter-count");
  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${state.requests.length} requests`;
  }

  const list = document.getElementById("admin-list");
  if (list) {
    if (!filtered.length) {
      list.innerHTML = '<li class="empty">No requests match the selected filters.</li>';
    } else {
      list.innerHTML = filtered.map((r) => requestCard(r)).join("");
    }
  }

  renderAdminEmployees();

  const pay = document.getElementById("admin-payroll");
  if (pay) {
    const approved = filtered.filter((r) => r.status === "approved" || r.status === "taken");
    const paidHrs = approved.filter((r) => r.payStatus === "paid").reduce((s, r) => s + (r.hours || 0), 0);
    const wpHrs = approved.filter((r) => r.payStatus === "without_pay").reduce((s, r) => s + (r.hours || 0), 0);
    pay.innerHTML = `
      <div class="meta">Filtered approved paid hours: <strong>${paidHrs}h</strong></div>
      <div class="meta">Filtered without-pay hours: <strong>${wpHrs}h</strong></div>
      <div class="meta">Export deadline: 21st of each month (org policy)</div>`;
  }
}

function renderAll() {
  fillDemoUserSelect();
  fillPayPeriodSelect();
  const iface = state.session.interface || "employee";
  if (iface === "employee") renderEmployee();
  if (iface === "manager") renderManager();
  if (iface === "admin") renderAdmin();
}

async function decide(id, status) {
  try {
    await api(`/api/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        managerComment: status === "approved" ? "Approved." : "Rejected.",
      }),
    });
    await loadState();
    renderAll();
    showToast(`Request ${status}. Saved on server.`, "success");
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
  const reason = document.getElementById("emp-reason")?.value.trim() || "";
  const retro = document.getElementById("emp-retro")?.checked;
  const hourDistribution = readHourDistribution();
  const totalHours = parseFloat(document.getElementById("emp-total-hours")?.value, 10);
  const distSum = hourDistribution.reduce((s, x) => s + x.hours, 0);

  if (bad.length) return showToast(`Invalid date(s): ${bad.join(", ")}`, "error");
  if (!leaveDates.length) return showToast("Add at least one intended leave date.", "error");
  if (!paySel?.value) return showToast("Select a pay period.", "error");
  if (!hourDistribution.length) return showToast("Add at least one leave type with hours.", "error");
  if (!reason) return showToast("Please enter a reason.", "error");
  if (!(totalHours > 0)) return showToast("Enter total hours.", "error");
  if (Math.abs(totalHours - distSum) > 0.01) {
    return showToast(`Total hours (${totalHours}) must match distribution sum (${distSum}).`, "error");
  }

  const payPeriod = {
    start: paySel.selectedOptions[0]?.dataset.start,
    end: paySel.selectedOptions[0]?.dataset.end,
    label: paySel.selectedOptions[0]?.dataset.label || paySel.selectedOptions[0]?.textContent,
  };
  const startDate = leaveDates[0];
  const endDate = leaveDates[leaveDates.length - 1];
  const days = countWeekdaysFromDates(leaveDates);
  const leaveType =
    hourDistribution.length === 1 ? hourDistribution[0].type : "Mixed leave types";

  try {
    await api("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        empId: emp.id,
        leaveDates,
        payPeriod,
        payPeriodLabel: payPeriod.label,
        hourDistribution,
        totalHours,
        leaveType,
        reason,
        startDate,
        endDate,
        days,
        hours: totalHours,
        retroactive: retro,
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
    showToast("LRF submitted via backend API.", "success");
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function reseed() {
  if (!window.confirm("Replace all data with HopeMission demo seed?")) return;
  try {
    const data = await api("/api/seed", { method: "POST" });
    state = { ...state, ...data };
    adminFilters = { department: "", costCentre: "", approvedBy: "" };
    renderAll();
    showToast("Demo data reloaded on server.", "success");
    setApiStatus(true, `${data.requests?.length ?? state.requests.length} requests`);
  } catch (err) {
    showToast(err.message, "error");
  }
}

function wireEvents() {
  document.querySelectorAll(".iface-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const iface = btn.dataset.interface;
      const emp = currentEmployee();
      let targetId = emp?.id;
      if (iface === "manager") {
        const mgr = state.employees.find((e) => e.systemRole === "manager");
        if (mgr) targetId = mgr.id;
      }
      if (iface === "admin") {
        const adm = state.employees.find((e) => e.systemRole === "admin");
        if (adm) targetId = adm.id;
      }
      await saveSession(targetId, iface);
      switchInterface(iface);
      showToast(`Switched to ${iface} interface.`, "info");
    });
  });

  document.getElementById("demo-user")?.addEventListener("change", async (e) => {
    const emp = state.employees.find((x) => x.id === e.target.value);
    const iface =
      emp?.systemRole === "manager"
        ? "manager"
        : emp?.systemRole === "admin"
          ? "admin"
          : "employee";
    await saveSession(emp.id, iface);
    switchInterface(iface);
    document.querySelectorAll(".iface-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.interface === iface);
    });
  });

  document.getElementById("form-employee")?.addEventListener("submit", submitEmployeeForm);
  document.getElementById("btn-reseed")?.addEventListener("click", reseed);
  document.getElementById("btn-add-dist")?.addEventListener("click", () => {
    document.getElementById("hour-dist-list")?.appendChild(createDistRow("Vacation", ""));
    syncDistributionTotal();
  });
  document.getElementById("emp-total-hours")?.addEventListener("input", (e) => {
    e.target.dataset.manual = "1";
  });

  ["admin-filter-dept", "admin-filter-cc", "admin-filter-approver"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      if (id === "admin-filter-dept") adminFilters.department = e.target.value;
      if (id === "admin-filter-cc") adminFilters.costCentre = e.target.value;
      if (id === "admin-filter-approver") adminFilters.approvedBy = e.target.value;
      renderAdmin();
    });
  });

  document.getElementById("admin-clear-filters")?.addEventListener("click", () => {
    adminFilters = { department: "", costCentre: "", approvedBy: "" };
    ["admin-filter-dept", "admin-filter-cc", "admin-filter-approver"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    renderAdmin();
  });
}

async function init() {
  document.getElementById("footer-year").textContent = new Date().getFullYear();
  initDistributionRows();
  wireEvents();

  try {
    await loadState();
    switchInterface(state.session.interface || "employee");
    showToast("HopeMission LRF connected to backend.", "success");
  } catch (err) {
    apiConnected = false;
    setApiStatus(false, err.message);
    showToast("Cannot reach backend. Start: node server-standalone.js", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => init());
