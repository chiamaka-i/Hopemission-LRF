/**
 * Hope Mission LRF — Manusonic Entry & HR reporting UI
 */
(function (global) {
  const LEAVE_CATS = [
    "Paid Sick Leave", "Personal Day", "Vacation", "OT Banked",
    "Bereavement", "Compassionate Care", "Without Pay",
  ];

  let verifyTargetId = null;
  let hrTab = "requests";
  let hrFilters = {
    payPeriod: "", year: "", department: "", costCentre: "", employmentType: "", category: "", status: "",
  };
  let snapshotFilters = {
    payPeriod: "", year: "", department: "", costCentre: "", employmentType: "",
  };

  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function currentEmp(state) {
    return state.employees.find((e) => e.id === state.session.empId);
  }

  function isAdmin(state) {
    return currentEmp(state)?.systemRole === "admin";
  }

  function isAdminOrHr(state) {
    const r = currentEmp(state)?.systemRole;
    return r === "admin" || r === "hr";
  }

  function verifiedOnly(requests) {
    return requests.filter((r) => r.verificationStatus === "verified" || r.verificationStatus === "posted" || r.postedToManusonic);
  }

  function payPeriodValue(r) {
    return r.payPeriod?.start && r.payPeriod?.end ? `${r.payPeriod.start}_${r.payPeriod.end}` : r.payPeriodLabel || "";
  }

  function hoursForCategory(r, cat) {
    return (r.hourDistribution || []).find((h) => h.type === cat)?.hours || 0;
  }

  function distFromCategoryInputs(form) {
    return LEAVE_CATS.map((type) => ({
      type,
      hours: parseFloat(form.querySelector(`[data-cat="${type}"]`)?.value, 10) || 0,
    })).filter((x) => x.hours > 0);
  }

  function markersHtml(markers) {
    if (!markers?.length) return "";
    return markers.map((m) => `<div class="attention-marker">⚠ ${esc(m.hint)}</div>`).join("");
  }

  function badgesHtml(r) {
    let html = "";
    if (r.proxySubmission) html += `<span class="badge badge--proxy">Proxy Submission</span> `;
    if (r.correctionsMade) html += `<span class="badge badge--corr">Corrections Made</span> `;
    return html;
  }

  function formatOriginalSubmission(r) {
    const sub = r.originalSubmission || r;
    const fieldRows = [
      ["Name", sub.empName],
      ["Employee ID", sub.empId],
      ["Pay Period", sub.payPeriodLabel],
      ["Year", sub.yearOfLeave],
      ["Days", sub.dayLabels || (sub.days != null ? String(sub.days) : null)],
      ["Shift Length", sub.shiftLength],
    ];
    (sub.hourDistribution || []).filter((h) => h.hours > 0).forEach((h) => {
      fieldRows.push([h.type, `${h.hours}h`]);
    });
    fieldRows.push(["Total Hours", sub.totalHours != null ? `${sub.totalHours}h` : null]);
    if (sub.additionalNotes) fieldRows.push(["Notes", sub.additionalNotes]);

    const tableRows = fieldRows
      .filter(([, v]) => v != null && String(v) !== "")
      .map(([f, v]) => `<tr><th style="text-align:left;padding:0.2rem 0.5rem;white-space:nowrap;font-weight:600">${esc(f)}</th><td style="padding:0.2rem 0.5rem">${esc(String(v))}</td></tr>`)
      .join("");

    let html = `<table class="data-table" style="margin:0.35rem 0"><tbody>${tableRows}</tbody></table>`;

    if (r.correctionsMade && r.auditTrail?.length) {
      r.auditTrail.forEach((audit, i) => {
        const orig = audit.originalValues || {};
        const corr = audit.correctedValues || {};
        const compareFields = [
          ["Name", orig.empName, corr.empName],
          ["Employee ID", orig.empId, corr.empId],
          ["Pay Period", orig.payPeriodLabel, corr.payPeriodLabel],
          ["Year", orig.yearOfLeave, corr.yearOfLeave],
          ["Days", orig.dayLabels, corr.dayLabels],
          ["Shift Length", orig.shiftLength, corr.shiftLength],
          ["Total Hours",
            orig.totalHours != null ? `${orig.totalHours}h` : null,
            corr.totalHours != null ? `${corr.totalHours}h` : null],
        ];
        LEAVE_CATS.forEach((cat) => {
          const o = (orig.hourDistribution || []).find((h) => h.type === cat)?.hours || 0;
          const c = (corr.hourDistribution || []).find((h) => h.type === cat)?.hours || 0;
          if (o !== c) compareFields.push([cat, o ? `${o}h` : "—", c ? `${c}h` : "—"]);
        });
        const changedRows = compareFields
          .filter(([, o, c]) => String(o ?? "") !== String(c ?? ""))
          .map(([f, o, c]) => `<tr><td style="padding:0.2rem 0.5rem">${esc(f)}</td><td style="padding:0.2rem 0.5rem">${esc(String(o ?? "—"))}</td><td style="padding:0.2rem 0.5rem">${esc(String(c ?? "—"))}</td></tr>`)
          .join("");
        html += `<h4 style="margin:0.6rem 0 0.2rem;font-size:0.8rem;color:var(--muted)">Correction ${i + 1}</h4>`;
        if (changedRows) {
          html += `<table class="data-table" style="margin:0.2rem 0"><thead><tr><th>Field</th><th>Original</th><th>Corrected</th></tr></thead><tbody>${changedRows}</tbody></table>`;
        }
        html += `<div class="meta" style="margin-top:0.3rem">
          <strong>Reason:</strong> ${esc(audit.correctionReason || "—")}<br>
          <strong>Note:</strong> ${esc(audit.correctionNote || "—")}<br>
          <strong>Corrected by:</strong> ${esc(audit.adminName || "—")}<br>
          <strong>At:</strong> ${esc(audit.timestamp ? new Date(audit.timestamp).toLocaleString() : "—")}
        </div>`;
      });
    }
    return html;
  }

  function pendingCard(r, state, { showPost = false } = {}) {
    const cats = (r.hourDistribution || []).filter((h) => h.hours > 0)
      .map((h) => `${h.hours}h ${h.type}`).join(" · ");
    const actions = showPost && isAdmin(state)
      ? `<button type="button" class="btn btn--ok btn--sm" data-post="${esc(r.id)}">Mark as Posted to Manusonic</button>`
      : "";
    return `<li class="item manu-card" data-id="${esc(r.id)}">
      <div class="item-body">
        <div class="item-top"><strong>${esc(r.empName)} (${esc(r.empId)})</strong> ${badgesHtml(r)}</div>
        <div class="meta"><strong>Employment:</strong> ${esc(r.employmentType)} · <strong>Title:</strong> ${esc(r.jobTitle)}</div>
        <div class="meta"><strong>Dept:</strong> ${esc(r.department)} · <strong>CC:</strong> ${esc(r.costCentre)}</div>
        <div class="meta"><strong>Shift:</strong> ${esc(r.shiftLength)} · <strong>Days:</strong> ${esc(r.dayLabels || r.days)}</div>
        <div class="meta"><strong>Categories:</strong> ${esc(cats)} · <strong>Total:</strong> ${r.totalHours}h</div>
        <div class="meta"><strong>Pay period:</strong> ${esc(r.payPeriodLabel)} · <strong>Year:</strong> ${esc(r.yearOfLeave)}</div>
        <div class="meta"><strong>Submitted:</strong> ${esc(fmtTimestamp(r.submittedAt || r.originalSubmittedAt))}</div>
        <div class="meta"><strong>Approved by:</strong> ${esc(r.approvedByName || "—")}</div>
        <div class="meta"><strong>Verified by:</strong> ${esc(r.verifiedByName || "—")} ${r.verifiedAt ? `(${esc(new Date(r.verifiedAt).toLocaleString())})` : ""}</div>
        ${r.additionalNotes ? `<div class="meta"><strong>Notes:</strong> ${esc(r.additionalNotes)}</div>` : ""}
        ${r.auditTrail?.length ? `<details class="audit-details"><summary>Correction history (${r.auditTrail.length})</summary><pre class="audit-pre">${esc(JSON.stringify(r.auditTrail, null, 2))}</pre></details>` : ""}
        ${r.originalSubmission ? `<details class="audit-details"><summary>Original Submission${r.correctionsMade ? " · Corrections Made" : ""}</summary>${formatOriginalSubmission(r)}</details>` : ""}
      </div>
      ${actions ? `<div class="actions">${actions}</div>` : ""}
    </li>`;
  }

  function reviewCard(r, state) {
    return `<li class="item manu-card" data-id="${esc(r.id)}">
      <div class="item-body">
        <div class="item-top"><strong>${esc(r.empName || "Unmatched")} (${esc(r.empId || "—")})</strong>
          <span class="badge badge--pending">Needs Review</span></div>
        ${r.supervisorSubmissionFlag ? `<div class="attention-banner">Supervisor or manager submission detected — please verify whether this is their own leave or a proxy submission on behalf of an absent staff member.</div>` : ""}
        ${markersHtml(r.reviewMarkers)}
        <div class="meta">Form ID: ${esc(r.formResponseId || "—")} · Submitted: ${esc(fmtTimestamp(r.originalSubmittedAt || r.submittedAt))}</div>
        <div class="meta">${esc(r.payPeriodLabel)} · ${r.totalHours}h · ${esc(r.shiftLength)}</div>
        <div class="meta">${(r.hourDistribution || []).map((h) => `${h.hours}h ${h.type}`).join(" · ")}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--sm" data-verify="${esc(r.id)}">Edit &amp; Verify</button>
        <button type="button" class="btn btn--ghost btn--sm" data-verify-unchanged="${esc(r.id)}">Verify Without Changes</button>
      </div>
    </li>`;
  }

  function renderManusonic(state) {
    if (!isAdminOrHr(state)) return;
    const admin = isAdmin(state);
    const unmatched = state.requests.filter((r) => r.verificationStatus === "needs_review" && r.unmatched);
    const needs = state.requests.filter((r) => r.verificationStatus === "needs_review" && !r.unmatched);
    const pending = state.requests.filter((r) => r.verificationStatus === "verified" && !r.postedToManusonic);
    const posted = state.requests.filter((r) => r.postedToManusonic);

    const demoTools = document.getElementById("admin-demo-tools");
    if (demoTools) demoTools.style.display = admin ? "" : "none";

    const unmatchedEl = document.getElementById("manu-unmatched");
    const unmatchedWrap = document.getElementById("manu-section-unmatched");
    if (unmatchedWrap) unmatchedWrap.style.display = admin ? "" : "none";
    if (unmatchedEl) {
      unmatchedEl.innerHTML = unmatched.length
        ? unmatched.map((r) => reviewCard(r, state)).join("")
        : '<li class="empty">No unmatched submissions.</li>';
    }

    const sec1 = document.getElementById("manu-needs-review");
    const sec1wrap = document.getElementById("manu-section-needs");
    if (sec1wrap) sec1wrap.style.display = admin ? "" : "none";
    if (sec1) {
      sec1.innerHTML = needs.length
        ? needs.map((r) => reviewCard(r, state)).join("")
        : '<li class="empty">No submissions awaiting Admin review.</li>';
    }

    const sec2 = document.getElementById("manu-pending");
    if (sec2) {
      sec2.innerHTML = pending.length
        ? pending.map((r) => pendingCard(r, state, { showPost: true })).join("")
        : '<li class="empty">No records pending Manusonic entry.</li>';
    }

    const sec3 = document.getElementById("manu-posted");
    if (sec3) {
      sec3.innerHTML = posted.length
        ? posted.map((r) => {
            const base = pendingCard(r, state);
            return base.replace("</div>", `<div class="meta"><strong>Posted by:</strong> ${esc(r.postedBy)} · ${esc(r.postedAt ? new Date(r.postedAt).toLocaleString() : "")}</div></div>`);
          }).join("")
        : '<li class="empty">No posted records yet.</li>';
    }
  }

  function filterHrRequests(requests) {
    return verifiedOnly(requests).filter((r) => {
      if (hrFilters.payPeriod && payPeriodValue(r) !== hrFilters.payPeriod && r.payPeriodLabel !== hrFilters.payPeriod) return false;
      if (hrFilters.year && String(r.yearOfLeave) !== hrFilters.year) return false;
      if (hrFilters.department && r.department !== hrFilters.department) return false;
      if (hrFilters.costCentre && r.costCentre !== hrFilters.costCentre) return false;
      if (hrFilters.employmentType && r.employmentType !== hrFilters.employmentType) return false;
      if (hrFilters.category && !hoursForCategory(r, hrFilters.category)) return false;
      if (hrFilters.status === "posted" && !r.postedToManusonic) return false;
      if (hrFilters.status === "verified" && r.postedToManusonic) return false;
      return true;
    });
  }

  function countUnverifiedForPeriod(state, payPeriodFilter) {
    return state.requests.filter((r) => {
      if (r.verificationStatus !== "needs_review") return false;
      if (!payPeriodFilter) return true;
      return r.payPeriodLabel === payPeriodFilter || payPeriodValue(r) === payPeriodFilter;
    }).length;
  }

  function renderHrTabs(state) {
    if (!isAdminOrHr(state)) return;

    document.querySelectorAll(".hr-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.hrTab === hrTab);
    });
    document.querySelectorAll(".hr-tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === `hr-tab-${hrTab}`);
    });

    if (hrTab === "requests") renderHrRequestsTable(state);
    if (hrTab === "snapshot") renderHrSnapshot(state);
    if (hrTab === "reports") renderHrReports(state);
  }

  function renderHrRequestsTable(state) {
    const el = document.getElementById("hr-requests-table");
    if (!el) return;
    const rows = filterHrRequests(state.requests);
    if (!rows.length) {
      el.innerHTML = '<p class="empty">No verified records found for the selected filters.</p>';
      return;
    }
    el.innerHTML = `<p class="verified-note">All data shown has been reviewed and verified by Admin</p>
      <table class="data-table"><thead><tr>
        <th>Employee</th><th>ID</th><th>Dept</th><th>Pay Period</th><th>Hours</th><th>Status</th><th>Flags</th>
      </tr></thead><tbody>${rows.map((r) => `<tr>
        <td>${esc(r.empName)}</td><td>${esc(r.empId)}</td><td>${esc(r.department)}</td>
        <td>${esc(r.payPeriodLabel)}</td><td>${r.totalHours}h</td>
        <td>${r.postedToManusonic ? "Posted" : "Verified"}</td>
        <td>${r.proxySubmission ? `<button type="button" class="link-btn" data-detail="${esc(r.id)}" data-kind="proxy">Proxy</button>` : ""}
            ${r.correctionsMade ? `<button type="button" class="link-btn" data-detail="${esc(r.id)}" data-kind="corr">Corrections</button>` : ""}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function applySnapshotFilters(requests) {
    return verifiedOnly(requests).filter((r) => {
      if (snapshotFilters.payPeriod && r.payPeriodLabel !== snapshotFilters.payPeriod && payPeriodValue(r) !== snapshotFilters.payPeriod) return false;
      if (snapshotFilters.year && String(r.yearOfLeave) !== snapshotFilters.year) return false;
      if (snapshotFilters.department && r.department !== snapshotFilters.department) return false;
      if (snapshotFilters.costCentre && r.costCentre !== snapshotFilters.costCentre) return false;
      if (snapshotFilters.employmentType && r.employmentType !== snapshotFilters.employmentType) return false;
      return true;
    });
  }

  function renderHrSnapshot(state) {
    const el = document.getElementById("hr-snapshot-body");
    if (!el) return;
    const data = applySnapshotFilters(state.requests);
    if (!data.length) {
      el.innerHTML = '<p class="empty">No verified records found for the selected filters.</p>';
      return;
    }

    const byCat = {};
    LEAVE_CATS.forEach((c) => { byCat[c] = { hours: 0, employees: new Set() }; });
    data.forEach((r) => {
      (r.hourDistribution || []).forEach((h) => {
        if (byCat[h.type]) {
          byCat[h.type].hours += h.hours;
          byCat[h.type].employees.add(r.empId);
        }
      });
    });

    const totalHrs = Object.values(byCat).reduce((s, x) => s + x.hours, 0);
    let breakdownLabel = "By Department";
    const breakdown = {};
    const dept = snapshotFilters.department;
    const cc = snapshotFilters.costCentre;

    data.forEach((r) => {
      const key = dept ? (cc ? r.costCentre : r.costCentre) : r.department;
      breakdown[key] = (breakdown[key] || 0) + (r.totalHours || 0);
    });
    if (dept) breakdownLabel = cc ? `Cost Centre: ${cc}` : "By Cost Centre";

    const unverified = countUnverifiedForPeriod(state, snapshotFilters.payPeriod);
    const warn = unverified
      ? `<div class="attention-marker">There are ${unverified} unverified submissions for this pay period. These are not included in this export. Contact Admin to review before final payroll processing.</div>`
      : "";

    el.innerHTML = `${warn}
      <p class="verified-note">All data shown has been reviewed and verified by Admin</p>
      <table class="data-table"><thead><tr><th>Category</th><th>Hours</th><th>Employees</th></tr></thead>
      <tbody>${LEAVE_CATS.map((c) => `<tr><td>${esc(c)}</td><td>${byCat[c].hours}</td><td>${byCat[c].employees.size}</td></tr>`).join("")}
      <tr class="total-row"><td><strong>TOTAL</strong></td><td><strong>${totalHrs}</strong></td><td>—</td></tr></tbody></table>
      <h3 class="snap-sub">${breakdownLabel}</h3>
      <table class="data-table"><tbody>${Object.entries(breakdown).sort().map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}h</td></tr>`).join("")}</tbody></table>
      <div class="snap-actions">
        <button type="button" class="btn btn--ghost btn--sm" id="btn-export-csv">Export CSV</button>
        <button type="button" class="btn btn--ghost btn--sm" id="btn-export-pdf">Export PDF</button>
      </div>`;
  }

  function renderHrReports(state) {
    const el = document.getElementById("hr-reports-table");
    if (!el) return;
    const rows = filterHrRequests(state.requests);
    if (!rows.length) {
      el.innerHTML = '<p class="empty">No verified records found for the selected filters.</p>';
      return;
    }
    const cols = ["Employee Name", "Employee ID", "Department", "Cost Centre", "Job Title", "Employment Type",
      "Pay Period", "Year", "Days", "Shift Length", ...LEAVE_CATS.map((c) => `${c} hrs`), "Total Hours", "Status",
      "Proxy (Y/N)", "Corrections Made (Y/N)", "Verified By", "Verified At", "Posted to Manusonic (Y/N)", "Posted By", "Posted At"];

    el.innerHTML = `<p class="verified-note">All data shown has been reviewed and verified by Admin</p>
      <button type="button" class="btn btn--ghost btn--sm" id="btn-reports-csv">Export CSV</button>
      <div class="table-scroll"><table class="data-table data-table--wide"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.empName)}</td><td>${esc(r.empId)}</td><td>${esc(r.department)}</td><td>${esc(r.costCentre)}</td>
        <td>${esc(r.jobTitle)}</td><td>${esc(r.employmentType)}</td><td>${esc(r.payPeriodLabel)}</td><td>${esc(r.yearOfLeave)}</td>
        <td>${esc(r.dayLabels || r.days)}</td><td>${esc(r.shiftLength)}</td>
        ${LEAVE_CATS.map((c) => `<td>${hoursForCategory(r, c)}</td>`).join("")}
        <td>${r.totalHours}</td><td>${r.postedToManusonic ? "Posted" : "Verified"}</td>
        <td>${r.proxySubmission ? "Y" : "N"}</td><td>${r.correctionsMade ? "Y" : "N"}</td>
        <td>${esc(r.verifiedByName)}</td><td>${esc(r.verifiedAt)}</td>
        <td>${r.postedToManusonic ? "Y" : "N"}</td><td>${esc(r.postedBy)}</td><td>${esc(r.postedAt)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function openVerifyModal(state, id) {
    verifyTargetId = id;
    const r = state.requests.find((x) => x.id === id);
    if (!r) return;
    const modal = document.getElementById("verify-modal");
    const form = document.getElementById("verify-form");
    if (!modal || !form) return;

    const catFields = LEAVE_CATS.map((c) => {
      const hrs = hoursForCategory(r, c);
      return `<div class="field cat-field"><label>${esc(c)}</label><input type="number" min="0" step="0.5" data-cat="${esc(c)}" value="${hrs || ""}" /></div>`;
    }).join("");

    form.innerHTML = `
      <div class="field"><label>Employee ID</label><input id="vf-empId" value="${esc(r.empId)}" /></div>
      <div class="field"><label>Name</label><input id="vf-name" value="${esc(r.empName)}" /></div>
      <div id="vf-rematch-msg" class="hint"></div>
      <div id="vf-name-warn" class="attention-marker" style="display:none"></div>
      <div class="field"><label>Pay Period</label><input id="vf-payperiod" value="${esc(r.payPeriodLabel)}" /></div>
      <div class="field"><label>Year of Leave</label><input id="vf-year" value="${esc(r.yearOfLeave)}" /></div>
      <div class="field"><label>Days</label><input id="vf-days" value="${esc(r.dayLabels || r.days)}" /></div>
      <div class="field"><label>Shift Length</label><select id="vf-shift">${(state.shiftLengths || ["8 Hours", "10 Hours", "12 Hours"]).map((s) => `<option${s === r.shiftLength ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      <div class="cat-grid">${catFields}</div>
      <div class="field"><label>Total Hours (auto)</label><input id="vf-total" readonly value="${r.totalHours}" /></div>
      <div class="field" id="vf-correction-wrap" style="display:none"><label>Correction reason</label>
        <select id="vf-reason">${(state.correctionReasons || []).map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("")}</select></div>
      <div class="field" id="vf-note-wrap" style="display:none"><label>Correction note</label><textarea id="vf-note"></textarea></div>
      <div class="field" id="vf-supervisor-wrap" style="display:none"><label>Submitted by (supervisor name)</label><input id="vf-supervisor" /></div>
      <details><summary>Original Submission (read-only)</summary>${formatOriginalSubmission(r)}</details>
      <div class="modal-actions">
        <button type="button" class="btn" id="vf-save">Save &amp; Verify</button>
        <button type="button" class="btn btn--ghost" id="vf-cancel">Cancel</button>
      </div>`;

    modal.classList.add("show");
    const proxyReason = "Submitted on behalf of absent staff member (supervisor submitted for employee)";
    const showCorrectionFields = () => {
      form.querySelector("#vf-correction-wrap").style.display = "";
      form.querySelector("#vf-note-wrap").style.display = "";
    };
    form.querySelectorAll("[data-cat], #vf-empId, #vf-name, #vf-payperiod, #vf-year, #vf-days, #vf-shift").forEach((inp) => {
      inp.addEventListener("input", () => {
        const sum = distFromCategoryInputs(form).reduce((s, x) => s + x.hours, 0);
        form.querySelector("#vf-total").value = String(sum);
        showCorrectionFields();
      });
      inp.addEventListener("change", showCorrectionFields);
    });
    form.querySelector("#vf-reason")?.addEventListener("change", (e) => {
      const isProxy = e.target.value === proxyReason;
      form.querySelector("#vf-supervisor-wrap").style.display = isProxy ? "" : "none";
    });
    form.querySelector("#vf-empId")?.addEventListener("change", () => {
      const emp = state.employees.find((e) => e.id === form.querySelector("#vf-empId").value);
      if (emp) {
        form.querySelector("#vf-name").value = emp.name;
        document.getElementById("vf-rematch-msg").textContent =
          `Record re-matched to ${emp.name} — ${emp.department} — ${emp.costCentre}. Please confirm this is correct.`;
      }
    });
    let origName = r.empName;
    let origId = r.empId;
    form.querySelector("#vf-name")?.addEventListener("input", (e) => {
      const warn = document.getElementById("vf-name-warn");
      if (e.target.value !== origName && form.querySelector("#vf-empId").value === origId) {
        warn.style.display = "";
        warn.textContent = "You changed the name but not the Employee ID. Please confirm the Employee ID also belongs to this person.";
      } else warn.style.display = "none";
    });
  }

  function closeVerifyModal() {
    document.getElementById("verify-modal")?.classList.remove("show");
    verifyTargetId = null;
  }

  async function saveVerify(state, api, loadState, renderAll) {
    const form = document.getElementById("verify-form");
    const r = state.requests.find((x) => x.id === verifyTargetId);
    if (!form || !r) return;

    const corrected = {
      empId: form.querySelector("#vf-empId")?.value,
      empName: form.querySelector("#vf-name")?.value,
      payPeriodLabel: form.querySelector("#vf-payperiod")?.value,
      yearOfLeave: form.querySelector("#vf-year")?.value,
      dayLabels: form.querySelector("#vf-days")?.value,
      days: String(form.querySelector("#vf-days")?.value).split(/[,;\s]+/).filter(Boolean).length,
      shiftLength: form.querySelector("#vf-shift")?.value,
      hourDistribution: distFromCategoryInputs(form),
      totalHours: parseFloat(form.querySelector("#vf-total")?.value, 10) || 0,
    };

    const payload = {
      corrected,
      correctionReason: form.querySelector("#vf-reason")?.value || "",
      correctionNote: form.querySelector("#vf-note")?.value || "",
      submittedBySupervisor: form.querySelector("#vf-supervisor")?.value || "",
    };

    await api(`/api/requests/${encodeURIComponent(verifyTargetId)}/verify`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    closeVerifyModal();
    await loadState();
    renderAll();
  }

  async function verifyUnchanged(id, api, loadState, renderAll, showToast) {
    await api(`/api/requests/${encodeURIComponent(id)}/verify`, {
      method: "PATCH",
      body: JSON.stringify({ verifyWithoutChanges: true }),
    });
    showToast("Verified without changes — moved to Pending Manusonic Entry.", "success");
    await loadState();
    renderAll();
  }

  async function postToManusonic(id, api, loadState, renderAll, showToast) {
    if (!confirm("Confirm you have manually entered this absence in Manusonic. This action cannot be undone.")) return;
    await api(`/api/requests/${encodeURIComponent(id)}/post-to-manusonic`, { method: "PATCH", body: "{}" });
    showToast("Posted to Manusonic — record locked.", "success");
    await loadState();
    renderAll();
  }

  function exportSnapshotCsv(state) {
    const data = applySnapshotFilters(state.requests);
    const unverified = countUnverifiedForPeriod(state, snapshotFilters.payPeriod);
    if (unverified && !confirm(`There are ${unverified} unverified submissions for this pay period. These are not included in this export. Contact Admin to review before final payroll processing.\n\nProceed with export?`)) return;

    const rows = [["Category", "Hours"]];
    LEAVE_CATS.forEach((c) => {
      const hrs = data.reduce((s, r) => s + hoursForCategory(r, c), 0);
      rows.push([c, hrs]);
    });
    const name = [
      "LeaveSnapshot",
      snapshotFilters.department || "AllDepts",
      snapshotFilters.costCentre || "AllCC",
      (snapshotFilters.payPeriod || "AllPeriods").replace(/\s/g, ""),
      snapshotFilters.year || "AllYears",
    ].join("_") + ".csv";
    downloadCsv(rows, name);
  }

  function downloadCsv(rows, filename) {
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  function wire(state, { api, loadState, renderAll, showToast }) {
    const handleVerifyClick = async (e) => {
      const vid = e.target.closest("[data-verify]")?.dataset.verify;
      const vnc = e.target.closest("[data-verify-unchanged]")?.dataset.verifyUnchanged;
      if (vid) openVerifyModal(window._appState, vid);
      if (vnc) await verifyUnchanged(vnc, api, loadState, renderAll, showToast);
    };
    document.getElementById("manu-needs-review")?.addEventListener("click", handleVerifyClick);
    document.getElementById("manu-unmatched")?.addEventListener("click", handleVerifyClick);

    document.getElementById("btn-reset-demo")?.addEventListener("click", async () => {
      if (!isAdmin(window._appState)) return;
      if (!confirm("Restore all fictional Hope Mission demo data? Current records will be replaced.")) return;
      try {
        const res = await api("/api/seed", { method: "POST", body: "{}" });
        showToast(res.message || "Demo data restored.", "success");
        await loadState();
        renderAll();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("manu-pending")?.addEventListener("click", async (e) => {
      const id = e.target.closest("[data-post]")?.dataset.post;
      if (id) await postToManusonic(id, api, loadState, renderAll, showToast);
    });

    document.getElementById("verify-modal")?.addEventListener("click", async (e) => {
      if (e.target.id === "vf-save") {
        try { await saveVerify(window._appState, api, loadState, renderAll); showToast("Verified — moved to Pending Manusonic Entry.", "success"); }
        catch (err) { showToast(err.message, "error"); }
      }
      if (e.target.id === "vf-cancel" || e.target.dataset.closeModal) closeVerifyModal();
    });

    document.querySelectorAll(".hr-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        hrTab = btn.dataset.hrTab;
        renderHrTabs(window._appState);
      });
    });

    ["hr-f-payperiod", "hr-f-year", "hr-f-dept", "hr-f-cc", "hr-f-emptype", "hr-f-cat", "hr-f-status"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", (e) => {
        const map = {
          "hr-f-payperiod": "payPeriod", "hr-f-year": "year", "hr-f-dept": "department",
          "hr-f-cc": "costCentre", "hr-f-emptype": "employmentType", "hr-f-cat": "category", "hr-f-status": "status",
        };
        hrFilters[map[id]] = e.target.value;
        renderHrTabs(window._appState);
      });
    });

    ["snap-f-payperiod", "snap-f-year", "snap-f-dept", "snap-f-cc", "snap-f-emptype"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", (e) => {
        const map = {
          "snap-f-payperiod": "payPeriod", "snap-f-year": "year", "snap-f-dept": "department",
          "snap-f-cc": "costCentre", "snap-f-emptype": "employmentType",
        };
        snapshotFilters[map[id]] = e.target.value;
        if (id === "snap-f-dept") {
          const ccSel = document.getElementById("snap-f-cc");
          if (ccSel) {
            const dept = e.target.value;
            const ccs = [...new Set(window._appState.requests.filter((r) => !dept || r.department === dept).map((r) => r.costCentre))].sort();
            ccSel.innerHTML = `<option value="">All cost centres</option>${ccs.map((c) => `<option>${esc(c)}</option>`).join("")}`;
          }
        }
        renderHrTabs(window._appState);
      });
    });

    document.getElementById("hr-snapshot-body")?.addEventListener("click", (e) => {
      if (e.target.id === "btn-export-csv") exportSnapshotCsv(window._appState);
      if (e.target.id === "btn-export-pdf") window.print();
    });

    document.getElementById("btn-staff-import")?.addEventListener("click", () => {
      document.getElementById("staff-import-file")?.click();
    });

    document.getElementById("staff-import-file")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const res = await api("/api/staff/import", { method: "POST", body: JSON.stringify({ csv: text }) });
        showToast(res.message, "success");
        await loadState();
        renderAll();
      } catch (err) {
        showToast(err.message, "error");
      }
      e.target.value = "";
    });

    document.getElementById("btn-hr-apply")?.addEventListener("click", () => {
      renderHrRequestsTable(window._appState);
    });
    document.getElementById("btn-hr-clear")?.addEventListener("click", () => {
      hrFilters = { payPeriod: "", year: "", department: "", costCentre: "", employmentType: "", category: "", status: "" };
      ["hr-f-payperiod", "hr-f-year", "hr-f-dept", "hr-f-cc", "hr-f-emptype", "hr-f-cat", "hr-f-status"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      renderHrRequestsTable(window._appState);
    });

    document.getElementById("btn-snap-apply")?.addEventListener("click", () => {
      renderHrSnapshot(window._appState);
    });
    document.getElementById("btn-snap-clear")?.addEventListener("click", () => {
      snapshotFilters = { payPeriod: "", year: "", department: "", costCentre: "", employmentType: "" };
      ["snap-f-payperiod", "snap-f-year", "snap-f-dept", "snap-f-cc", "snap-f-emptype"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      renderHrSnapshot(window._appState);
    });
  }

  function fillHrFilterOptions(state) {
    const periods = [...new Set(state.requests.map((r) => r.payPeriodLabel).filter(Boolean))].sort();
    const years = [...new Set(state.requests.map((r) => r.yearOfLeave).filter(Boolean))].sort();
    const depts = [...new Set(state.employees.map((e) => e.department))].sort();
    const fill = (id, opts, allLabel) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = `<option value="">${allLabel}</option>${opts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}`;
    };
    fill("hr-f-payperiod", periods, "All pay periods");
    fill("snap-f-payperiod", periods, "All pay periods");
    fill("hr-f-year", years, "All years");
    fill("snap-f-year", years, "All years");
    fill("hr-f-dept", depts, "All departments");
    fill("snap-f-dept", depts, "All departments");
    fill("hr-f-emptype", state.employmentTypes || [], "All employment types");
    fill("snap-f-emptype", state.employmentTypes || [], "All employment types");
    fill("hr-f-cat", LEAVE_CATS, "All categories");
  }

  function updateNavVisibility(state) {
    // Sidebar is built role-specifically at sign-in — no runtime visibility changes needed
  }

  function renderHrSection(state, sectionId) {
    if (!isAdminOrHr(state)) return;
    const tabMap = {
      "s-admin-requests": "requests",
      "s-admin-snapshot": "snapshot",
      "s-admin-reports":  "reports",
    };
    const tab = tabMap[sectionId];
    if (!tab) return;
    hrTab = tab;
    if (tab === "requests") renderHrRequestsTable(state);
    if (tab === "snapshot") renderHrSnapshot(state);
    if (tab === "reports")  renderHrReports(state);
  }

  global.ManusonicUI = {
    renderManusonic,
    renderHrTabs,
    renderHrSection,
    fillHrFilterOptions,
    updateNavVisibility,
    wire,
    isAdmin,
    isAdminOrHr,
  };
})(window);
