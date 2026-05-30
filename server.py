"""
Leave / LRF API server (stdlib only — no npm required).
Run: python server.py
Then open http://localhost:3001
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PORT = int(os.environ.get("PORT", "3001"))
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STORE_PATH = DATA_DIR / "store.json"

COST_CENTRES = {
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
}


def is_contract_role(role: str) -> bool:
    return role in ("Part-Time / Contract Staff", "FTT Staff")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
}


def today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def resolve_cost_centre(group: str) -> str:
    return COST_CENTRES.get(group, "UNASSIGNED")


def gen_id() -> str:
    import random
    import time

    return f"lrf_{int(time.time() * 1000):x}_{random.randint(0, 0xFFFFFF):06x}"


def read_store() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        store = {"records": []}
        STORE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")
        return store
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data.get("records"), list):
            return {"records": []}
        return data
    except (json.JSONDecodeError, OSError):
        return {"records": []}


def write_store(store: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(json.dumps(store, indent=2), encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "LeaveFlowAPI/1.0"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/health":
            return self._json(200, {"ok": True, "service": "leaveflow-api-python"})

        if path == "/api/leaves":
            store = read_store()
            records = sorted(
                store["records"],
                key=lambda r: r.get("timeMarked") or "",
                reverse=True,
            )
            return self._json(200, records)

        return self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/api/leaves":
            return self._json(404, {"error": "Not found"})

        body = self._read_json()
        full_name = (body.get("fullName") or "").strip()
        role = (body.get("role") or "").strip()
        group = (body.get("group") or "").strip()
        date = (body.get("date") or "").strip()

        if not all([full_name, role, group, date]):
            return self._json(400, {"error": "fullName, role, group, and date are required."})

        record = {
            "id": body.get("id") or gen_id(),
            "fullName": full_name,
            "role": role,
            "group": group,
            "date": date,
            "status": body.get("status") or "present",
            "timeMarked": body.get("timeMarked") or datetime.now(timezone.utc).isoformat(),
            "costCentre": body.get("costCentre") or resolve_cost_centre(group),
            "hours": body.get("hours") if body.get("hours") else 8,
            "leaveCategory": body.get("leaveCategory")
            or ("Without Pay" if is_contract_role(role) else "Logged Leave"),
            "isRetroactive": body.get("isRetroactive", date < today_iso()),
            "employeeType": body.get("employeeType")
            or ("Contract" if is_contract_role(role) else "Full-Time"),
        }

        store = read_store()
        store["records"].insert(0, record)
        write_store(store)
        return self._json(201, record)

    def do_PATCH(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/leaves/"):
            return self._json(404, {"error": "Not found"})

        record_id = path.split("/api/leaves/", 1)[1]
        body = self._read_json()
        store = read_store()
        for item in store["records"]:
            if item.get("id") == record_id:
                if "status" in body:
                    item["status"] = body["status"]
                if "managerComment" in body:
                    item["managerComment"] = body["managerComment"]
                item["updatedAt"] = datetime.now(timezone.utc).isoformat()
                write_store(store)
                return self._json(200, item)
        return self._json(404, {"error": "Record not found."})

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/leaves":
            return self._json(404, {"error": "Not found"})

        body = self._read_json()
        incoming = body.get("records") if isinstance(body, dict) else body
        if not isinstance(incoming, list):
            return self._json(400, {"error": "Expected array or { records: [] }."})
        write_store({"records": incoming})
        return self._json(200, {"count": len(incoming)})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/leaves/"):
            return self._json(404, {"error": "Not found"})

        record_id = path.split("/api/leaves/", 1)[1]
        store = read_store()
        before = len(store["records"])
        store["records"] = [r for r in store["records"] if r.get("id") != record_id]
        if len(store["records"]) == before:
            return self._json(404, {"error": "Record not found."})
        write_store(store)
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _serve_static(self, path: str):
        if path == "/":
            path = "/index.html"
        file_path = (ROOT / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.is_file():
            file_path = ROOT / "index.html"
            if not file_path.is_file():
                return self._json(404, {"error": "Not found"})

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(file_path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer(("", PORT), Handler)
    print(f"LeaveFlow API + frontend: http://localhost:{PORT}")
    print(f"API health check:         http://localhost:{PORT}/api/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
