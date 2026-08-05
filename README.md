# cassidy-calendar-feed

Fast Smartsheet -> JSON feed for the **Cassidy TV calendars**.

The calendar pages themselves stay in
[`cassidy-tv-calendars`](https://github.com/cassidysmartsheet-ux/cassidy-tv-calendars).
Only the *data* lives here.

## Why this exists

The feed in the calendar repo asks GitHub to refresh every 5 minutes. Measured
across all 1,109 runs since 2026-05-06, GitHub actually delivered about **12 runs
a day** — a median gap of **94 minutes**, best 51, worst 216. GitHub's scheduled
trigger is best-effort and has never honoured `*/5` for that repo.

Rather than argue with the trigger, this job **stays resident**: one run refreshes
every 5 minutes for a 340-minute shift (GitHub caps a job at 6h), then dispatches
its own replacement. Cron is only a safety net for restarting a dead chain.

It also lives in its own repo on purpose, so its site rebuilds can never eat into
the calendar repo's build budget.

## Safety properties

- **Smartsheet is read-only here.** The only call made is `GET /2.0/reports/{id}`.
  There is no code path that can create, update or delete anything in Smartsheet.
- **Commits only on real change.** `scripts/changed.py` ignores `generatedAt` and
  compares the events themselves, so a timestamp alone never triggers a rebuild.
  GitHub Pages soft-caps builds at 10/hour and the old design burned one per run.
- **Refuses to publish an empty feed.** A failed or partial fetch is discarded
  rather than committed, so a Smartsheet blip cannot blank the TVs.
- **Token is an encrypted Actions secret**, not plaintext in the workflow.
- **No handoff on cancellation.** A cancelled shift does not dispatch a
  successor — that caused a cancel storm in testing on 2026-08-05.

## Consumers

`calendar-utils.js` in the calendar repo reads `data-v2.json` from this repo's
GitHub Pages and falls back to its own local `data.json` if this feed is missing,
broken, empty, or older. The fallback means this repo failing is a non-event.
