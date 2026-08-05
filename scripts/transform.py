"""Transform raw Smartsheet Report API JSON into the events array our
TV calendars consume. Reads report JSON from stdin, writes data.json to stdout.

Schema in/out matches what calendar-utils.js used to produce from its
loadEventsFromReport() function. Same column IDs.
"""
import json, re, sys
from datetime import datetime, timezone

COL = {
    "JOB_NUM":       7358000912879492,
    "COMPANY_NAME":  171009385385860,
    "CITY":          3980301192351620,
    "PHASE":         4824726122483588,
    "START":         8765375796432772,
    "END":           180389006757764,
    "STATUS":        4683988634128260,
    "ASSIGNED_CREW": 8202425843011460,
}

def cell_value(row, column_id):
    for c in (row.get("cells") or []):
        if int(c.get("columnId", 0)) == int(column_id):
            v = c.get("value")
            if v is not None:
                return v
            return c.get("displayValue")
    return None

def parse_date(s):
    if not s: return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(s))
    if not m: return None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

raw = json.load(sys.stdin)
events = []
for row in (raw.get("rows") or []):
    status   = cell_value(row, COL["STATUS"])
    job_num  = cell_value(row, COL["JOB_NUM"])
    start    = cell_value(row, COL["START"])
    if not job_num or not start: continue
    if status == "Cancelled": continue

    sd = parse_date(start)
    if not sd: continue
    ed = parse_date(cell_value(row, COL["END"])) or sd

    crew_raw  = cell_value(row, COL["ASSIGNED_CREW"])
    phase_raw = cell_value(row, COL["PHASE"])

    events.append({
        "jobNumber":    str(job_num),
        "client":       cell_value(row, COL["COMPANY_NAME"]) or "",
        "city":         cell_value(row, COL["CITY"]) or "",
        "crew":         crew_raw or phase_raw or "",
        "phase":        phase_raw or "",
        "startDate":    sd,
        "endDate":      ed,
        "status":       status or "",
    })

out = {
    "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "Smartsheet Operations Calendar Report (id 3854855551537028)",
    "totalRows": raw.get("totalRowCount"),
    "events": events,
}
json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
