"""Transform raw Smartsheet Subcontractor Schedule sheet JSON into the events
array consumed by subc.html via data-subcontractor.json.

Reads sheet JSON from stdin, writes data-subcontractor.json shape to stdout.

Migrated from cassidy-tv-calendars on 2026-08-11 so that the subcontractor
board no longer depends on the retired repo. Byte-for-byte the same output
schema as the original -- only the home of the pipeline changed.

Smartsheet access is READ ONLY. The workflow that calls this makes exactly one
GET request; there is no code path here that can write to Smartsheet.
"""
import json, re, sys
from datetime import datetime, timezone

SHEET_ID = "1314998310621060"

# Column titles on the Subcontractor Schedule sheet.
# Resolved by title (not by hard-coded id) so the script survives someone
# reordering or inserting columns on the sheet.
COL_TITLES = {
    "JOB_NUM":   "Job #",
    "COMPANY":   "Company",
    "CLIENT":    "Client First",
    "CITY":      "Job City",
    "SUB_CREW":  "Subcontractor Crew",
    "SCOPE":     "Scope",
    "START":     "Start Date",
    "END":       "End Date",
    "STATUS":    "Status",
}


def resolve_column_ids(columns):
    by_title = {c.get("title"): c.get("id") for c in columns}
    missing = [k for k, title in COL_TITLES.items() if title not in by_title]
    if missing:
        sys.stderr.write(
            "transform-subcontractor: missing columns on sheet: %s\n" % missing
        )
        sys.exit(1)
    return {key: by_title[title] for key, title in COL_TITLES.items()}


def cell_value(row, column_id):
    for c in (row.get("cells") or []):
        if int(c.get("columnId", 0)) == int(column_id):
            v = c.get("value")
            if v is not None:
                return v
            return c.get("displayValue")
    return None


def parse_date(s):
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(s))
    if not m:
        return None
    return "%s-%s-%s" % (m.group(1), m.group(2), m.group(3))


def clean(v):
    """Strip stray wrapping quotes that have crept into some picklist values.

    'Subcontractor Crew' contains entries literally stored as
    '"H & N Pavement Marking, INC"' -- quotes included. subc.html colour-maps
    on this exact string, so the quoted form silently falls through to the
    generic swatch. Normalising here fixes the colour without touching
    Smartsheet, which is strictly read-only from this pipeline.
    """
    if v is None:
        return ""
    s = str(v).strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1].strip()
    return s


raw = json.load(sys.stdin)
col_ids = resolve_column_ids(raw.get("columns") or [])

events = []
for row in (raw.get("rows") or []):
    status = cell_value(row, col_ids["STATUS"])
    job_num = cell_value(row, col_ids["JOB_NUM"])
    start = cell_value(row, col_ids["START"])

    if not job_num or not start:
        continue
    if status == "Cancelled":
        continue

    sd = parse_date(start)
    if not sd:
        continue
    ed = parse_date(cell_value(row, col_ids["END"])) or sd

    events.append({
        "jobNumber":   str(job_num),
        "client":      clean(cell_value(row, col_ids["COMPANY"])),
        "clientFirst": clean(cell_value(row, col_ids["CLIENT"])),
        "city":        clean(cell_value(row, col_ids["CITY"])),
        "crew":        clean(cell_value(row, col_ids["SUB_CREW"])),
        "scope":       clean(cell_value(row, col_ids["SCOPE"])),
        "phase":       "Subcontractor",
        "startDate":   sd,
        "endDate":     ed,
        "status":      status or "",
    })

out = {
    "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "Smartsheet Subcontractor Schedule sheet (id %s)" % SHEET_ID,
    "totalRows": raw.get("totalRowCount"),
    "events": events,
}
json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
