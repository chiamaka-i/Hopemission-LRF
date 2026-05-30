// ─────────────────────────────────────────────────────────────────────────────
//  PO & Invoice Tracker  |  src/App.jsx
//  Stack: React 18 + Vite + chart.js  |  Storage: localStorage
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";
Chart.register(...registerables);

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const PO_STATUSES  = ["Draft", "Pending", "Approved", "Received", "Cancelled"];
const INV_STATUSES = ["Draft", "Pending", "Approved", "Paid", "Overdue"];

const STATUS_STYLE = {
  Draft:     { bg: "#F4F5F7", color: "#636E72" },
  Pending:   { bg: "#FEF3DC", color: "#D68910" },
  Approved:  { bg: "#D6EAF8", color: "#1A5276" },
  Received:  { bg: "#D5F5E3", color: "#1E8449" },
  Paid:      { bg: "#D5F5E3", color: "#1E8449" },
  Overdue:   { bg: "#FDECEA", color: "#C0392B" },
  Cancelled: { bg: "#F5EEF8", color: "#8E44AD" },
};

const SEED_POS = [
  { id: "po1", number: "PO-2025-001", vendor: "Acme Supplies Co.",     description: "Office furniture & equipment",   date: "2025-01-15", dueDate: "2025-02-15", amount: 12500, status: "Received",  notes: "" },
  { id: "po2", number: "PO-2025-002", vendor: "TechPro Solutions",     description: "Laptop computers ×5",            date: "2025-02-01", dueDate: "2025-03-01", amount: 8750,  status: "Approved",  notes: "Urgent" },
  { id: "po3", number: "PO-2025-003", vendor: "Global Logistics Inc.", description: "Shipping services Q1",           date: "2025-02-20", dueDate: "2025-03-20", amount: 3200,  status: "Pending",   notes: "" },
  { id: "po4", number: "PO-2025-004", vendor: "CleanServ LLC",         description: "Office cleaning monthly",        date: "2025-03-01", dueDate: "2025-03-31", amount: 950,   status: "Draft",     notes: "" },
  { id: "po5", number: "PO-2025-005", vendor: "PrintMasters",          description: "Marketing materials print run",  date: "2025-03-10", dueDate: "2025-04-10", amount: 4600,  status: "Cancelled", notes: "Budget cut" },
];

const SEED_INV = [
  { id: "inv1", number: "INV-2025-001", vendor: "Acme Supplies Co.",     poRef: "PO-2025-001", description: "Office furniture & equipment",   date: "2025-01-20", dueDate: "2025-02-20", amount: 12500, status: "Paid",     notes: "" },
  { id: "inv2", number: "INV-2025-002", vendor: "TechPro Solutions",     poRef: "PO-2025-002", description: "Laptop computers ×5",            date: "2025-02-05", dueDate: "2025-03-05", amount: 8750,  status: "Approved", notes: "" },
  { id: "inv3", number: "INV-2025-003", vendor: "Global Logistics Inc.", poRef: "PO-2025-003", description: "Shipping services Q1",           date: "2025-02-25", dueDate: "2025-03-25", amount: 3200,  status: "Pending",  notes: "" },
  { id: "inv4", number: "INV-2025-004", vendor: "SupplyChain Co.",       poRef: "",            description: "Raw materials batch 7",          date: "2025-01-10", dueDate: "2025-02-10", amount: 15800, status: "Overdue",  notes: "Follow up required" },
  { id: "inv5", number: "INV-2025-005", vendor: "DataSystems Ltd.",      poRef: "",            description: "Software licenses annual",        date: "2025-03-01", dueDate: "2025-04-01", amount: 6200,  status: "Draft",    notes: "" },
];

// ─────────────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const fmt   = (n) => "$" + Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const tod   = () => new Date().toISOString().slice(0, 10);
const in30  = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

function saveData(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.error("Storage error:", e); }
}
function loadData(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SHARED STYLE TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  navy:    "#0D1B2A",
  navyMd:  "#1A2E45",
  gold:    "#C9A84C",
  gray:    "#F4F5F7",
  grayMd:  "#DDE0E6",
  grayDk:  "#7F8C8D",
  text:    "#1C2333",
  white:   "#FFFFFF",
  green:   "#1E8449",
  red:     "#C0392B",
};

const inputStyle = {
  width: "100%", boxSizing: "border-box",
  padding: "9px 12px",
  border: `1.5px solid ${C.grayMd}`,
  borderRadius: 8, fontSize: 14,
  fontFamily: "inherit", outline: "none",
  background: C.white, color: C.text,
  transition: "border-color .15s",
};

const labelStyle = {
  fontSize: 11, fontWeight: 700, color: C.grayDk,
  display: "block", marginBottom: 5,
  textTransform: "uppercase", letterSpacing: "0.07em",
};

// ─────────────────────────────────────────────────────────────────────────────
//  BADGE
// ─────────────────────────────────────────────────────────────────────────────
function Badge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.Draft;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: "3px 11px", borderRadius: 99,
      fontSize: 11, fontWeight: 700,
      whiteSpace: "nowrap", display: "inline-block",
      letterSpacing: "0.02em",
    }}>
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  KPI CARD
// ─────────────────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, valueColor }) {
  return (
    <div style={{
      background: C.gray, borderRadius: 10,
      padding: "14px 18px", flex: "1 1 140px", minWidth: 0,
      border: `1px solid ${C.grayMd}`,
    }}>
      <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: C.grayDk, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 23, fontWeight: 800, color: valueColor || C.navy }}>
        {value}
      </p>
      {sub && <p style={{ margin: "3px 0 0", fontSize: 11, color: C.grayDk }}>{sub}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  RECORD FORM  (inline — no modal)
// ─────────────────────────────────────────────────────────────────────────────
const BLANK_PO  = { number: "", vendor: "", description: "", date: "", dueDate: "", amount: "", status: "Draft",  notes: "" };
const BLANK_INV = { number: "", vendor: "", poRef: "", description: "", date: "", dueDate: "", amount: "", status: "Draft",  notes: "" };

function RecordForm({ type, item, onSave, onCancel, pos }) {
  const isPO     = type === "po";
  const statuses = isPO ? PO_STATUSES : INV_STATUSES;
  const blank    = isPO
    ? { ...BLANK_PO,  date: tod(), dueDate: in30() }
    : { ...BLANK_INV, date: tod(), dueDate: in30() };

  const [f, setF] = useState(item ? { ...item, amount: String(item.amount) } : blank);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    if (!f.number.trim())                    { alert("Please enter a document number."); return; }
    if (!f.vendor.trim())                    { alert("Please enter a vendor name."); return; }
    if (!f.amount || isNaN(Number(f.amount))){ alert("Please enter a valid amount."); return; }
    onSave({ ...f, id: item?.id || genId(), amount: Number(f.amount) });
  };

  return (
    <div style={{
      background: C.white, border: `1.5px solid ${C.grayMd}`,
      borderRadius: 12, padding: "22px 26px", marginBottom: 14,
    }}>
      {/* Form header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 15, color: C.navy }}>
          {item ? "Edit" : "New"} {isPO ? "Purchase Order" : "Invoice"}
        </p>
        <button
          onClick={onCancel}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: C.grayDk, lineHeight: 1, padding: "0 4px" }}
        >
          ×
        </button>
      </div>

      {/* Fields grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        <div>
          <label style={labelStyle}>{isPO ? "PO Number" : "Invoice Number"} *</label>
          <input style={inputStyle} value={f.number} onChange={set("number")} placeholder={isPO ? "PO-2025-006" : "INV-2025-006"} />
        </div>

        <div>
          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={f.status} onChange={set("status")}>
            {statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Vendor *</label>
          <input style={inputStyle} value={f.vendor} onChange={set("vendor")} placeholder="Vendor or supplier name" />
        </div>

        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={f.description} onChange={set("description")} placeholder="Goods or services description" />
        </div>

        {!isPO && (
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>Linked PO</label>
            <select style={inputStyle} value={f.poRef} onChange={set("poRef")}>
              <option value="">— none —</option>
              {pos.map((p) => (
                <option key={p.id} value={p.number}>{p.number} — {p.vendor}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label style={labelStyle}>Amount (CAD) *</label>
          <input style={inputStyle} type="number" step="0.01" value={f.amount} onChange={set("amount")} placeholder="0.00" />
        </div>

        <div>
          <label style={labelStyle}>Status preview</label>
          <div style={{ paddingTop: 9 }}><Badge status={f.status} /></div>
        </div>

        <div>
          <label style={labelStyle}>Date</label>
          <input style={inputStyle} type="date" value={f.date} onChange={set("date")} />
        </div>

        <div>
          <label style={labelStyle}>Due Date</label>
          <input style={inputStyle} type="date" value={f.dueDate} onChange={set("dueDate")} />
        </div>

        <div style={{ gridColumn: "1/-1" }}>
          <label style={labelStyle}>Notes</label>
          <input style={inputStyle} value={f.notes} onChange={set("notes")} placeholder="Optional notes or comments" />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{ padding: "9px 22px", border: `1.5px solid ${C.grayMd}`, borderRadius: 8, background: C.white, cursor: "pointer", fontSize: 13, fontFamily: "inherit", color: C.text, fontWeight: 600 }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          style={{ padding: "9px 26px", border: "none", borderRadius: 8, background: C.navy, color: C.gold, cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 800 }}
        >
          {item ? "Save changes" : isPO ? "Create PO" : "Create Invoice"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  FILTER BAR
// ─────────────────────────────────────────────────────────────────────────────
function FilterBar({ type, filter, setFilter, onNew }) {
  const isPO     = type === "po";
  const statuses = isPO ? PO_STATUSES : INV_STATUSES;

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
      {/* Search */}
      <div style={{ position: "relative", flex: 1 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.grayDk, pointerEvents: "none", fontSize: 15 }}>
          ⌕
        </span>
        <input
          style={{ ...inputStyle, paddingLeft: 34 }}
          placeholder={isPO ? "Search purchase orders…" : "Search invoices…"}
          value={filter.q}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
        />
      </div>

      {/* Status filter */}
      <select
        style={{ ...inputStyle, width: "auto", minWidth: 150 }}
        value={filter.status}
        onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
      >
        <option value="all">All statuses</option>
        {statuses.map((s) => <option key={s}>{s}</option>)}
      </select>

      {/* New button */}
      <button
        onClick={onNew}
        style={{
          padding: "9px 20px", border: "none", borderRadius: 8,
          background: C.navy, color: C.gold, cursor: "pointer",
          fontSize: 13, fontFamily: "inherit", fontWeight: 800, whiteSpace: "nowrap",
        }}
      >
        + {isPO ? "New PO" : "New Invoice"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATA TABLE
// ─────────────────────────────────────────────────────────────────────────────
function DataTable({ rows, allRows, type, onEdit, onDelete }) {
  const isPO    = type === "po";
  const total   = rows.reduce((s, r) => s + r.amount, 0);
  const colW    = ["16%", "28%", "14%", "14%", "18%", "10%"];
  const headers = [isPO ? "PO #" : "Invoice #", "Vendor", "Amount", "Due Date", "Status", ""];

  return (
    <div style={{ border: `1.5px solid ${C.grayMd}`, borderRadius: 12, overflow: "hidden", background: C.white }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>

        <thead>
          <tr style={{ background: C.gray }}>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  padding: "10px 13px", textAlign: "left", fontWeight: 700,
                  fontSize: 10, color: C.grayDk, textTransform: "uppercase",
                  letterSpacing: "0.08em", borderBottom: `1.5px solid ${C.grayMd}`,
                  width: colW[i],
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: C.grayDk, fontSize: 13 }}>
                No records found. Use the button above to create one.
              </td>
            </tr>
          ) : (
            rows.map((r, idx) => (
              <tr
                key={r.id}
                style={{ borderBottom: idx < rows.length - 1 ? `1px solid ${C.gray}` : "none", transition: "background .1s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.gray}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <td style={{ padding: "11px 13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontFamily: "DM Mono, monospace", color: C.navy }}>
                  {r.number}
                </td>
                <td style={{ padding: "11px 13px", overflow: "hidden" }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: C.text }}>
                    {r.vendor}
                  </div>
                  <div style={{ fontSize: 11, color: C.grayDk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.description || (r.poRef ? `Ref: ${r.poRef}` : "")}
                  </div>
                </td>
                <td style={{ padding: "11px 13px", fontWeight: 700, fontSize: 13, color: C.navy }}>
                  {fmt(r.amount)}
                </td>
                <td style={{ padding: "11px 13px", color: C.grayDk, fontSize: 12 }}>
                  {r.dueDate}
                </td>
                <td style={{ padding: "11px 13px" }}>
                  <Badge status={r.status} />
                </td>
                <td style={{ padding: "11px 13px" }}>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      title="Edit"
                      onClick={() => onEdit(r)}
                      style={{ padding: "5px 9px", border: `1px solid ${C.grayMd}`, borderRadius: 6, background: C.white, cursor: "pointer", fontSize: 13, color: C.text }}
                    >
                      ✎
                    </button>
                    <button
                      title="Delete"
                      onClick={() => onDelete(r.id)}
                      style={{ padding: "5px 9px", border: "1px solid #FDECEA", borderRadius: 6, background: "#FDECEA", cursor: "pointer", fontSize: 13, color: C.red }}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>

        <tfoot>
          <tr style={{ background: C.gray, borderTop: `1.5px solid ${C.grayMd}` }}>
            <td colSpan={2} style={{ padding: "9px 13px", fontSize: 11, color: C.grayDk, fontWeight: 700 }}>
              {rows.length} of {allRows.length} records
            </td>
            <td style={{ padding: "9px 13px", fontWeight: 800, fontSize: 13, color: C.navy }}>
              {fmt(total)}
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>

      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  APP (root component)
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,     setTab]     = useState("dashboard");
  const [pos,     setPOs]     = useState([]);
  const [invs,    setInvs]    = useState([]);
  const [ready,   setReady]   = useState(false);
  const [editing, setEditing] = useState(null);   // { type: "po"|"inv", item: null | {...} }
  const [poF,     setPOF]     = useState({ status: "all", q: "" });
  const [inF,     setINF]     = useState({ status: "all", q: "" });
  const chartRef  = useRef(null);
  const chartInst = useRef(null);

  // ── Load from localStorage ─────────────────────────────────────
  useEffect(() => {
    setPOs(loadData("tracker:pos")  || SEED_POS);
    setInvs(loadData("tracker:invs") || SEED_INV);
    setReady(true);
  }, []);

  // ── Persist on change ──────────────────────────────────────────
  useEffect(() => { if (ready) saveData("tracker:pos",  pos);  }, [pos,  ready]);
  useEffect(() => { if (ready) saveData("tracker:invs", invs); }, [invs, ready]);

  // ── Dashboard chart ────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "dashboard" || !chartRef.current) return;
    if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }

    const byStatus = PO_STATUSES.reduce((acc, s) => {
      acc[s] = pos.filter((p) => p.status === s).reduce((t, p) => t + p.amount, 0);
      return acc;
    }, {});

    chartInst.current = new Chart(chartRef.current.getContext("2d"), {
      type: "bar",
      data: {
        labels: PO_STATUSES,
        datasets: [{
          data: PO_STATUSES.map((s) => byStatus[s]),
          backgroundColor: ["#B4B2A9", "#EF9F27", "#378ADD", "#639922", "#E24B4A"],
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 12, family: "DM Sans, sans-serif" } },
          },
          y: {
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: {
              callback: (v) => "$" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
              font: { size: 12, family: "DM Sans, sans-serif" },
            },
          },
        },
      },
    });

    return () => {
      if (chartInst.current) { chartInst.current.destroy(); chartInst.current = null; }
    };
  }, [tab, pos]);

  // ── Derived metrics ────────────────────────────────────────────
  const totalPO = pos.reduce((s, p) => s + p.amount, 0);
  const totalIN = invs.reduce((s, i) => s + i.amount, 0);
  const paid    = invs.filter((i) => i.status === "Paid").reduce((s, i) => s + i.amount, 0);
  const overdue = invs.filter((i) => i.status === "Overdue").reduce((s, i) => s + i.amount, 0);

  // ── Filtered rows ──────────────────────────────────────────────
  const filtPOs = pos.filter((p) =>
    (poF.status === "all" || p.status === poF.status) &&
    (!poF.q || [p.number, p.vendor, p.description].some((x) => x.toLowerCase().includes(poF.q.toLowerCase())))
  );
  const filtINs = invs.filter((i) =>
    (inF.status === "all" || i.status === inF.status) &&
    (!inF.q || [i.number, i.vendor, i.description].some((x) => x.toLowerCase().includes(inF.q.toLowerCase())))
  );

  // ── CRUD helpers ───────────────────────────────────────────────
  const savePO  = (item) => { setPOs((p)  => item.id && p.some((x) => x.id === item.id) ? p.map((x) => x.id === item.id ? item : x) : [...p, item]);  setEditing(null); };
  const delPO   = (id)   => { if (window.confirm("Permanently delete this purchase order?")) setPOs((p)  => p.filter((x) => x.id !== id)); };
  const saveINV = (item) => { setInvs((i) => item.id && i.some((x) => x.id === item.id) ? i.map((x) => x.id === item.id ? item : x) : [...i, item]); setEditing(null); };
  const delINV  = (id)   => { if (window.confirm("Permanently delete this invoice?"))           setInvs((i) => i.filter((x) => x.id !== id)); };

  const switchTab = (t) => { setTab(t); setEditing(null); };

  // ── Tab button style ───────────────────────────────────────────
  const tabBtnStyle = (active) => ({
    flex: 1, padding: "10px 14px", border: "none", cursor: "pointer",
    fontSize: 13, fontFamily: "inherit", fontWeight: active ? 800 : 500,
    borderRadius: 8, transition: "all .15s",
    background: active ? C.navy  : "transparent",
    color:      active ? C.gold  : C.grayDk,
  });

  // ── Chart legend colours ───────────────────────────────────────
  const barColors = ["#B4B2A9", "#EF9F27", "#378ADD", "#639922", "#E24B4A"];

  // ── Card helper ────────────────────────────────────────────────
  const card = {
    background: C.white,
    border: `1.5px solid ${C.grayMd}`,
    borderRadius: 12,
    padding: "18px 22px",
    marginBottom: 14,
  };

  if (!ready) {
    return (
      <div style={{ padding: "4rem", textAlign: "center", color: C.grayDk, fontFamily: "DM Sans, sans-serif" }}>
        Loading...
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "DM Sans, sans-serif", maxWidth: 940, margin: "0 auto", padding: "28px 24px 80px" }}>

      {/* ── Page header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        marginBottom: 26, paddingBottom: 18,
        borderBottom: `2.5px solid ${C.navy}`,
      }}>
        <div>
          <p style={{ margin: "0 0 5px", fontSize: 10, fontWeight: 800, color: C.gold, textTransform: "uppercase", letterSpacing: "0.14em" }}>
            ◈ Financial Operations
          </p>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: C.navy, letterSpacing: "-0.03em" }}>
            PO & Invoice Tracker
          </h1>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 10, color: C.grayDk, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.07em" }}>Purchase Orders</p>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 22, color: C.navy }}>{pos.length}</p>
          </div>
          <div style={{ width: 1, height: 34, background: C.grayMd }} />
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 10, color: C.grayDk, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.07em" }}>Invoices</p>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 22, color: C.navy }}>{invs.length}</p>
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", gap: 4, background: C.gray,
        padding: 4, borderRadius: 10, border: `1px solid ${C.grayMd}`,
        marginBottom: 24,
      }}>
        {[
          ["dashboard", "⊞  Dashboard"],
          ["pos",       "📋  Purchase Orders"],
          ["invoices",  "🧾  Invoices"],
        ].map(([t, label]) => (
          <button key={t} style={tabBtnStyle(tab === t)} onClick={() => switchTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════ DASHBOARD ═══ */}
      {tab === "dashboard" && (
        <>
          {/* KPI row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <KPI label="Total PO Value"  value={fmt(totalPO)} sub={`${pos.length} orders`} />
            <KPI label="Total Invoiced"  value={fmt(totalIN)} sub={`${invs.length} invoices`} />
            <KPI label="Amount Paid"     value={fmt(paid)}    sub="settled invoices"  valueColor={C.green} />
            <KPI label="Overdue"         value={fmt(overdue)} sub="past due date"     valueColor={C.red} />
          </div>

          {/* Spend chart */}
          <div style={card}>
            <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 800, color: C.navy }}>
              PO value by status
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: C.grayDk }}>
              Total committed spend across all purchase order lifecycle stages
            </p>
            <div style={{ position: "relative", height: 210 }}>
              <canvas ref={chartRef} role="img" aria-label="Bar chart of PO value grouped by status" />
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
              {PO_STATUSES.map((s, i) => (
                <span key={s} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.grayDk }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: barColors[i], display: "inline-block" }} />
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Recent activity panels */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[
              ["Recent POs",      pos.slice(-4).reverse()],
              ["Recent Invoices", invs.slice(-4).reverse()],
            ].map(([title, items]) => (
              <div key={title} style={card}>
                <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 800, color: C.navy }}>{title}</p>
                {items.map((item, idx) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 0",
                      borderTop: idx > 0 ? `1px solid ${C.gray}` : "none",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "DM Mono, monospace", color: C.navy }}>
                        {item.number}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: C.grayDk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.vendor}
                      </p>
                    </div>
                    <Badge status={item.status} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ════════════════════════════════ PURCHASE ORDERS ═══ */}
      {tab === "pos" && (
        <>
          <FilterBar type="po" filter={poF} setFilter={setPOF} onNew={() => setEditing({ type: "po", item: null })} />
          {editing?.type === "po" && (
            <RecordForm type="po" item={editing.item} onSave={savePO} onCancel={() => setEditing(null)} pos={pos} />
          )}
          <DataTable
            rows={filtPOs} allRows={pos} type="po"
            onEdit={(item) => setEditing({ type: "po", item })}
            onDelete={delPO}
          />
        </>
      )}

      {/* ════════════════════════════════════ INVOICES ═══════ */}
      {tab === "invoices" && (
        <>
          <FilterBar type="inv" filter={inF} setFilter={setINF} onNew={() => setEditing({ type: "inv", item: null })} />
          {editing?.type === "inv" && (
            <RecordForm type="inv" item={editing.item} onSave={saveINV} onCancel={() => setEditing(null)} pos={pos} />
          )}
          <DataTable
            rows={filtINs} allRows={invs} type="inv"
            onEdit={(item) => setEditing({ type: "inv", item })}
            onDelete={delINV}
          />
        </>
      )}

    </div>
  );
}
