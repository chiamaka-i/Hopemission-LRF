/**
 * Hope Mission LRF — Manusonic-aligned constants (exact names, exact order)
 */

const LEAVE_CATEGORIES = [
  "Paid Sick Leave",
  "Personal Day",
  "Vacation",
  "OT Banked",
  "Bereavement",
  "Compassionate Care",
  "Without Pay",
];

const EMPLOYMENT_TYPES = ["RFT Salaried", "RFT Hourly", "FTT"];

const SHIFT_LENGTHS = ["8 Hours", "10 Hours", "12 Hours"];

const PORTAL_ROLES = ["manager", "admin", "hr"];

const FTT_REVIEW_MSG =
  "FTT staff submitted paid leave categories — please review before posting to Manusonic";

const NO_PORTAL_ACCESS_MSG =
  "Your account does not have access to the Hope Mission LRF management portal. Please submit your leave request using the Microsoft Form.";

const HOURLY_EXCLUDED = new Set(["Vacation", "OT Banked"]);

const PAID_CATEGORIES = new Set(
  LEAVE_CATEGORIES.filter((c) => c !== "Without Pay")
);

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Pay period: 21st of month M through 20th of month M+1 */
function payPeriodForDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput + "T12:00:00");
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < 21) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  const start = new Date(y, m, 21);
  const end = new Date(y, m + 1, 20);
  const label = `${MONTHS_FULL[start.getMonth()]} 21 – ${MONTHS_FULL[end.getMonth()]} 20`;
  return {
    start: toISO(start),
    end: toISO(end),
    label,
    value: `${toISO(start)}_${toISO(end)}`,
  };
}

function buildPayPeriodOptions(count = 18) {
  const seen = new Set();
  const options = [];
  const now = new Date();
  for (let offset = -Math.floor(count / 2); offset <= Math.floor(count / 2); offset += 1) {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 15);
    const p = payPeriodForDate(ref);
    if (seen.has(p.value)) continue;
    seen.add(p.value);
    options.push(p);
  }
  return options.sort((a, b) => a.start.localeCompare(b.start));
}

function categoriesForEmploymentType(employmentType) {
  if (employmentType === "RFT Hourly") {
    return LEAVE_CATEGORIES.filter((c) => !HOURLY_EXCLUDED.has(c));
  }
  return [...LEAVE_CATEGORIES];
}

function canAccessPortal(employee) {
  return employee && PORTAL_ROLES.includes(employee.systemRole);
}

function evaluateLeaveSubmission(employee, hourDistribution) {
  const employmentType = employee.employmentType || "RFT Salaried";
  const allowed = new Set(categoriesForEmploymentType(employmentType));
  const invalid = hourDistribution.filter((row) => !allowed.has(row.type));
  const paidSubmitted = hourDistribution.some((row) => PAID_CATEGORIES.has(row.type));
  const fttReviewFlag = employmentType === "FTT" && paidSubmitted;

  let payStatus = "paid";
  if (employmentType === "FTT") {
    payStatus = "without_pay";
  } else if (hourDistribution.every((row) => row.type === "Without Pay")) {
    payStatus = "without_pay";
  }

  return { invalid, fttReviewFlag, payStatus, employmentType };
}

function summarizeLeaveTypes(hourDistribution) {
  if (!hourDistribution?.length) return "—";
  const types = [...new Set(hourDistribution.map((h) => h.type))];
  return types.length === 1 ? types[0] : types.join(" · ");
}

module.exports = {
  LEAVE_CATEGORIES,
  EMPLOYMENT_TYPES,
  SHIFT_LENGTHS,
  PORTAL_ROLES,
  FTT_REVIEW_MSG,
  NO_PORTAL_ACCESS_MSG,
  PAID_CATEGORIES,
  payPeriodForDate,
  buildPayPeriodOptions,
  categoriesForEmploymentType,
  canAccessPortal,
  evaluateLeaveSubmission,
  summarizeLeaveTypes,
};
