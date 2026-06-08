/**
 * Hope Mission LRF — Manusonic verification & MS Forms logic (server-side)
 */

const {
  LEAVE_CATEGORIES,
  EMPLOYMENT_TYPES,
  SHIFT_LENGTHS,
  FTT_REVIEW_MSG,
  PAID_CATEGORIES,
  summarizeLeaveTypes,
} = require("./constants");

const CORRECTION_REASONS = [
  "Submitted on behalf of absent staff member (supervisor submitted for employee)",
  "Staff entered zero hours",
  "Staff entered incorrect hours",
  "Staff selected wrong pay period",
  "Staff selected wrong shift length",
  "Hours split incorrectly across categories",
  "Employee ID entered incorrectly by staff",
  "Other (requires note)",
];

const SUPERVISOR_KEYWORDS = [
  "Supervisor",
  "Manager",
  "Coordinator",
  "Director",
  "Team Lead",
  "Senior Manager",
  "Senior Director",
  "Senior Coordinator",
];

const CATEGORY_FIELD_MAP = [
  { key: "paidSickLeave", type: "Paid Sick Leave" },
  { key: "personalDay", type: "Personal Day" },
  { key: "vacation", type: "Vacation" },
  { key: "otBanked", type: "OT Banked" },
  { key: "bereavement", type: "Bereavement" },
  { key: "compassionateCare", type: "Compassionate Care" },
  { key: "withoutPay", type: "Without Pay" },
];

function isAdminRole(emp) {
  return emp?.systemRole === "admin";
}

function isAdminOrHr(emp) {
  return emp?.systemRole === "admin" || emp?.systemRole === "hr";
}

function jobTitleSuggestsSupervisor(jobTitle) {
  const t = String(jobTitle || "");
  return SUPERVISOR_KEYWORDS.some((kw) => t.toLowerCase().includes(kw.toLowerCase()));
}

function parseShiftLength(raw) {
  const s = String(raw || "").trim();
  if (SHIFT_LENGTHS.includes(s)) return s;
  const n = parseInt(s, 10);
  if (n === 8) return "8 Hours";
  if (n === 10) return "10 Hours";
  if (n === 12) return "12 Hours";
  return s || null;
}

function hourDistributionFromPayload(body) {
  return CATEGORY_FIELD_MAP.map(({ key, type }) => ({
    type,
    hours: Number(body[key]) || 0,
  })).filter((r) => r.hours > 0);
}

function snapshotRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function distSum(dist) {
  return (dist || []).reduce((s, r) => s + (Number(r.hours) || 0), 0);
}

function computeReviewMarkers(record, employee, submitterEmployee) {
  const markers = [];
  const dist = record.hourDistribution || [];
  const catSum = distSum(dist);
  const total = Number(record.totalHours) || 0;
  const empType = record.employmentType || employee?.employmentType;
  const formType = String(record.formType || "").toLowerCase();

  if (total === 0) {
    markers.push({ code: "zero_total", hint: "Total hours is zero — please confirm" });
  }
  if (Math.abs(catSum - total) > 0.01 && total > 0) {
    markers.push({
      code: "sum_mismatch",
      hint: "Sum of category hours does not match stated total — please confirm",
    });
  }
  if (empType === "FTT" && dist.some((r) => PAID_CATEGORIES.has(r.type) && r.hours > 0)) {
    markers.push({
      code: "ftt_paid",
      hint: "FTT staff submitted paid leave categories — please review before posting to Manusonic",
    });
  }
  if (
    (formType === "hourly" || empType === "RFT Hourly") &&
    dist.some((r) => (r.type === "Vacation" || r.type === "OT Banked") && r.hours > 0)
  ) {
    markers.push({
      code: "hourly_vac_ot",
      hint: "Hourly form includes Vacation or OT Banked hours — please confirm",
    });
  }
  const submitterTitle = submitterEmployee?.jobRole || record.submitterJobTitle || record.jobTitle;
  if (jobTitleSuggestsSupervisor(submitterTitle)) {
    markers.push({
      code: "supervisor_proxy",
      hint: "Submitter job title suggests supervisor/manager — please verify whether this is their own leave or a proxy submission",
    });
  }
  if (record.matchedByName) {
    markers.push({
      code: "name_match",
      hint: "Matched by name — Employee ID could not be verified. Please confirm.",
    });
  }
  if (record.unmatched) {
    markers.push({
      code: "unmatched",
      hint: "Employee could not be matched in directory — please assign correct Employee ID",
    });
  }
  if (record.supervisorSubmissionFlag) {
    markers.push({
      code: "supervisor_banner",
      hint: "Supervisor or manager submission detected — please verify whether this is their own leave or a proxy submission on behalf of an absent staff member",
    });
  }
  return markers;
}

function parseDaysField(daysRaw) {
  return String(daysRaw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePayPeriodLabel(raw) {
  return String(raw || "")
    .replace(/\s*-\s*/g, " – ")
    .replace(/February 21/g, "February 20")
    .trim();
}

function buildMsFormRecord(body, store, matchResult) {
  const hourDistribution = hourDistributionFromPayload(body);
  const totalHours = hourDistribution.reduce((s, r) => s + r.hours, 0);
  const shiftLength = parseShiftLength(body.shiftLength);
  const payPeriodLabel = normalizePayPeriodLabel(body.payPeriod);
  const daysList = parseDaysField(body.days);
  const yearOfLeave = String(body.yearOfLeave || new Date().getFullYear()).trim();
  const formType = String(body.formType || "").toLowerCase();
  const now = new Date().toISOString();

  const emp = matchResult.employee;
  const reqRecord = {
    id: `MS-${body.formResponseId || Date.now()}`,
    source: "microsoft_forms",
    formResponseId: String(body.formResponseId || ""),
    formType,
    empId: emp?.id || String(body.employeeId || "").trim() || null,
    empName: emp?.name || String(body.name || "").trim(),
    initials: emp?.initials || (body.name || "??").slice(0, 2).toUpperCase(),
    jobTitle: emp?.jobRole || "",
    department: emp?.department || "",
    costCentre: emp?.costCentre || "",
    managerId: emp?.managerId || null,
    managerName: emp?.managerName || null,
    employmentType: emp?.employmentType || "",
    leaveType: summarizeLeaveTypes(hourDistribution) || "—",
    leaveDates: daysList,
    days: daysList.length || Number(body.days) || 0,
    dayLabels: daysList.join(", "),
    payPeriod: { label: payPeriodLabel },
    payPeriodLabel,
    yearOfLeave,
    hourDistribution,
    totalHours,
    hours: totalHours,
    shiftLength: shiftLength || "",
    reason: String(body.additionalNotes || "").trim() || "Microsoft Form submission",
    additionalNotes: String(body.additionalNotes || "").trim(),
    startDate: daysList[0] || null,
    endDate: daysList[daysList.length - 1] || null,
    status: emp?.skipApproval ? "approved" : "pending",
    verificationStatus: "needs_review",
    payStatus: emp?.employmentType === "FTT" ? "without_pay" : totalHours > 0 && hourDistribution.every((r) => r.type === "Without Pay") ? "without_pay" : "paid",
    fttReviewFlag: emp?.employmentType === "FTT" && hourDistribution.some((r) => PAID_CATEGORIES.has(r.type) && r.hours > 0),
    postedToManusonic: false,
    postedAt: null,
    postedBy: null,
    proxySubmission: false,
    correctionsMade: false,
    verifiedBy: null,
    verifiedAt: null,
    verifiedByName: null,
    matchedByName: matchResult.matchedByName || false,
    unmatched: matchResult.unmatched || false,
    supervisorSubmissionFlag: false,
    submittedAt: body.completionTime || body.startTime || now,
    originalSubmittedAt: body.completionTime || body.startTime || now,
    managerComment: null,
    approvedById: emp?.skipApproval ? null : null,
    approvedByName: emp?.skipApproval ? "Auto-approved (pending Admin verify)" : null,
    skipApproval: !!emp?.skipApproval,
    auditTrail: [],
    originalSubmission: null,
  };

  reqRecord.supervisorSubmissionFlag = jobTitleSuggestsSupervisor(emp?.jobRole);
  reqRecord.reviewMarkers = computeReviewMarkers(reqRecord, emp, emp);
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
    formResponseId: reqRecord.formResponseId,
    submittedAt: reqRecord.submittedAt,
  });

  return reqRecord;
}

function matchEmployee(store, employeeId, name) {
  const id = String(employeeId || "").trim().toUpperCase();
  const byId = store.employees.find((e) => e.id.toUpperCase() === id && e.active !== false);
  if (byId) return { employee: byId, matchedByName: false, unmatched: false };

  const nm = String(name || "").trim().toLowerCase();
  const byName = store.employees.find(
    (e) => e.active !== false && e.name.trim().toLowerCase() === nm
  );
  if (byName) return { employee: byName, matchedByName: true, unmatched: false };

  return { employee: null, matchedByName: false, unmatched: true };
}

function rematchEmployee(store, empId) {
  const emp = store.employees.find((e) => e.id === empId && e.active !== false);
  if (!emp) return null;
  return {
    empId: emp.id,
    empName: emp.name,
    initials: emp.initials,
    jobTitle: emp.jobRole,
    department: emp.department,
    costCentre: emp.costCentre,
    employmentType: emp.employmentType || "",
    managerId: emp.managerId,
    managerName: emp.managerName,
  };
}

function isVerifiedForHr(record) {
  return record.verificationStatus === "verified" || record.postedToManusonic === true;
}

function fieldsChanged(original, corrected) {
  const keys = [
    "empId", "empName", "payPeriodLabel", "yearOfLeave", "days", "shiftLength", "hourDistribution", "totalHours",
  ];
  return keys.some((k) => JSON.stringify(original[k]) !== JSON.stringify(corrected[k]));
}

function applyVerification(record, payload, adminEmp) {
  if (record.postedToManusonic) {
    throw new Error("This record has already been posted to Manusonic and cannot be modified.");
  }

  const now = new Date().toISOString();
  const adminName = adminEmp?.name || "Admin";
  const verifyWithoutChanges = !!payload.verifyWithoutChanges;

  if (!verifyWithoutChanges) {
    const corrected = payload.corrected || {};
    const original = record.originalSubmission || snapshotRecord(record);
    const changed = fieldsChanged(original, corrected);

    if (changed) {
      if (!payload.correctionReason) {
        throw new Error("Correction reason is required when fields are changed.");
      }
      if (!CORRECTION_REASONS.includes(payload.correctionReason)) {
        throw new Error("Invalid correction reason.");
      }
      const isProxy =
        payload.correctionReason ===
        "Submitted on behalf of absent staff member (supervisor submitted for employee)";
      if (isProxy && !String(payload.correctionNote || "").trim()) {
        throw new Error("Correction note is required for proxy submissions.");
      }
      if (isProxy && !String(payload.submittedBySupervisor || "").trim()) {
        throw new Error('Submitted by (supervisor name) is required for proxy submissions.');
      }
      if (payload.correctionReason.includes("Other") && !String(payload.correctionNote || "").trim()) {
        throw new Error("Note is required when correction reason is Other.");
      }

      const audit = {
        originalEmpId: original.empId,
        originalEmpName: original.empName,
        correctedEmpId: corrected.empId || record.empId,
        correctedEmpName: corrected.empName || record.empName,
        originalValues: snapshotRecord(original),
        correctedValues: snapshotRecord(corrected),
        correctionReason: payload.correctionReason,
        correctionNote: payload.correctionNote || "",
        submittedBySupervisor: payload.submittedBySupervisor || "",
        adminName,
        adminId: adminEmp?.id,
        timestamp: now,
      };
      record.auditTrail = record.auditTrail || [];
      record.auditTrail.push(audit);
      record.correctionsMade = true;
      if (isProxy) record.proxySubmission = true;

      Object.assign(record, corrected);
    }
  }

  record.verificationStatus = "verified";
  record.verifiedBy = adminEmp?.id;
  record.verifiedByName = adminName;
  record.verifiedAt = now;
  record.status = "manusonic_queue";
  record.leaveType = summarizeLeaveTypes(record.hourDistribution);
  record.hours = record.totalHours;

  return record;
}

function parseStaffCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const idI = idx(["employee id", "employeeid", "id"]);
  const nameI = idx(["full name", "fullname", "name"]);
  const titleI = idx(["job title", "jobtitle", "title"]);
  const deptI = idx(["department", "dept"]);
  const ccI = idx(["cost centre", "cost centre", "costcenter", "cost centre"]);

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      id: (cols[idI] || "").toUpperCase(),
      name: cols[nameI] || "",
      jobRole: cols[titleI] || "",
      department: cols[deptI] || "",
      costCentre: cols[ccI] || "",
    };
  }).filter((r) => r.id);
}

module.exports = {
  CORRECTION_REASONS,
  SUPERVISOR_KEYWORDS,
  CATEGORY_FIELD_MAP,
  isAdminRole,
  isAdminOrHr,
  jobTitleSuggestsSupervisor,
  parseShiftLength,
  hourDistributionFromPayload,
  snapshotRecord,
  computeReviewMarkers,
  buildMsFormRecord,
  matchEmployee,
  rematchEmployee,
  isVerifiedForHr,
  applyVerification,
  parseStaffCsv,
  distSum,
};
