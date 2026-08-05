"""Compare the meaningful content of two feed files, ignoring the timestamp.

Exit 0  -> the schedule data actually changed (worth committing)
Exit 1  -> nothing changed but the clock (do NOT commit)

This is the whole point of the experiment: the live feed re-commits on every
single run because it stamps generatedAt into the file, which means every run
rebuilds the website and burns the 10-builds-per-hour ceiling. We only commit
when a human actually changed the schedule.
"""
import json, sys

def payload(path):
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    return {"source": d.get("source"), "totalRows": d.get("totalRows"), "events": d.get("events")}

old_path, new_path = sys.argv[1], sys.argv[2]

try:
    old = payload(old_path)
except (OSError, ValueError):
    print("no readable previous file -> treating as changed")
    sys.exit(0)

try:
    new = payload(new_path)
except (OSError, ValueError) as exc:
    print("new file unreadable (%s) -> refusing to commit" % exc)
    sys.exit(1)

if not new.get("events"):
    print("new file has zero events -> refusing to commit (guard against a bad fetch)")
    sys.exit(1)

if old == new:
    print("unchanged")
    sys.exit(1)

o = {(e.get("jobNumber"), e.get("startDate")) for e in (old.get("events") or [])}
n = {(e.get("jobNumber"), e.get("startDate")) for e in (new.get("events") or [])}
print("changed: %d events -> %d events (+%d / -%d job-date pairs)"
      % (len(old.get("events") or []), len(new["events"]), len(n - o), len(o - n)))
sys.exit(0)
