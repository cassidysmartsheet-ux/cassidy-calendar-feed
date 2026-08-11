// Shared calendar utilities for TV displays
// Reads from data.json which is refreshed every 5 min by a GitHub Action
// that calls the Smartsheet "Operations Calendar Report" server-side.
//
// Why not call the Smartsheet API from the browser directly?
// Smartsheet's API does NOT return Access-Control-Allow-Origin headers,
// so any browser fetch() to api.smartsheet.com is blocked by CORS. Server-side
// (curl/Node/GitHub Actions runner) works fine, browsers do not. See
// .github/workflows/refresh-data.yml for the refresh pipeline.

// ============ CREW COLOR PALETTE ============
// Mirrors the Smartsheet Calendar App's per-crew swatches so a crew's jobs
// look the same on the boardroom TVs as they do on the user's phone app.
const CREW_COLORS = {
  'Milling':         '#3B5BA5',
  'Crackfill':       '#E2B33D',
  'Paving':          '#C13548',
  'Reclaim/Grading': '#C56F87',
  'Hand':            '#8E83BD',
  'Pulverizing':     '#E89E7E',
  'Subcontractor':   '#A8B143'
};

const CREW_SLUGS = {
  'Milling':         'milling',
  'Paving':          'paving',
  'Crackfill':       'crackfill',
  'Hand':            'hand',
  'Reclaim/Grading': 'reclaimgrading',
  'Pulverizing':     'pulverizing',
  'Subcontractor':   'subcontractor'
};

const CREW_CODES = {
  'Milling':         'MILL',
  'Paving':          'PAVE',
  'Crackfill':       'CRCK',
  'Hand':            'HAND',
  'Reclaim/Grading': 'RECL',
  'Pulverizing':     'PULV',
  'Subcontractor':   'SUBC'
};

function getCrewSlug(crew) { return CREW_SLUGS[crew] || 'milling'; }
function getCrewCode(crew) { return CREW_CODES[crew] || ''; }

// ============ EVENT LOADING ============
// ONE source: data-v2.json in this repo, refreshed every 5 minutes by a
// resident job (see .github/workflows/refresh-feed.yml).
//
// This used to race a second "legacy" feed hosted on the original calendar
// repo and take whichever looked freshest. That repo was retired 2026-08-11,
// but the fallback was removed for a stronger reason than tidiness: it was a
// correctness hazard. If the fast feed went quiet for longer than its trust
// window, the boards would silently switch to the legacy feed -- and on
// 2026-08-11 that feed was missing real scheduled work (filler jobs whose
// Job # had not propagated from the setup sheet). A board that quietly swaps
// to stale data is worse than one that shows its age, because nobody can tell.
//
// If this feed is unavailable the board now renders empty and the freshness
// badge reads "unavailable", which is loud and obvious on a TV.
const FAST_FEED_URL   = './data-v2.json';
const FEED_TIMEOUT_MS = 4000;   // never let a hung fetch freeze a TV

async function fetchFeed(url, cacheBuster) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const sep = url.includes('?') ? '&' : '?';
    const resp = await fetch(`${url}${sep}cb=${cacheBuster}`, { cache: 'no-store', signal: controller.signal });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const payload = await resp.json();
    if (!payload || !Array.isArray(payload.events) || payload.events.length === 0) {
      throw new Error('no events in payload');
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function feedAgeMs(payload) {
  const t = Date.parse(payload.generatedAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : (Date.now() - t);
}

async function loadEvents() {
  const cb = Math.floor(Date.now() / 60000); // changes once per minute

  let payload;
  try {
    payload = await fetchFeed(FAST_FEED_URL, cb);
  } catch (err) {
    console.warn('[calendar] feed unavailable:', err && err.message);
    updateFreshnessBadge(null, null);
    return [];
  }

  const ageMin = Math.round(feedAgeMs(payload) / 60000);
  console.log(`[calendar] ${payload.events.length} events, ${ageMin} min old (generated ${payload.generatedAt})`);
  updateFreshnessBadge('fast', ageMin);

  const events = payload.events.map(e => ({
    jobNumber: e.jobNumber,
    client:    e.client || '',
    city:      e.city || '',
    crew:      e.crew || e.phase || '',
    phase:     e.phase || '',
    startDate: parseISODate(e.startDate),
    endDate:   parseISODate(e.endDate) || parseISODate(e.startDate),
    status:    e.status || ''
  })).filter(e => e.startDate);

  return events;
}

// Small on-screen indicator so Dan can see at a glance how old the data is
// and which feed answered. Harmless if the element is absent.
function updateFreshnessBadge(feedName, ageMin) {
  const el = document.getElementById('feed-freshness');
  if (!el) return;
  if (!feedName) { el.textContent = 'unavailable'; return; }
  // The fast feed republishes on change, plus a liveness beat every 20 min, so
  // this reads as "confirmed current as of", not "we have not looked since".
  el.textContent = ageMin <= 1 ? 'just now' : ageMin + ' min ago';
}

// Parse 'YYYY-MM-DD' as a local-naive date so calendar-cell positioning
// is consistent regardless of the client's timezone.
function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

// ============ FILTER / DATE GRID ============
function filterEventsByCrew(events, crew) {
  if (!crew) return events;
  return events.filter(e => e.crew === crew);
}
// Backwards-compat alias for HTML still using the old name
function filterEventsByPhase(events, crew) { return filterEventsByCrew(events, crew); }

function getCalendarDates(today) {
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const startDate = new Date(sevenDaysAgo);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  startDate.setHours(0, 0, 0, 0);
  const dates = [];
  const current = new Date(startDate);
  for (let i = 0; i < 42; i++) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getEventsForDate(events, date) {
  return events.filter(event => {
    const eventStart = new Date(event.startDate);
    const eventEnd = new Date(event.endDate);
    eventStart.setHours(0, 0, 0, 0);
    eventEnd.setHours(23, 59, 59, 999);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate >= eventStart && checkDate <= eventEnd;
  });
}

function formatDateShort(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatMonthYear(date) {
  return new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ============ ADAPTIVE DENSITY ============
function applyAdaptiveDensity() {
  const cells = document.querySelectorAll('.day-cell');
  cells.forEach(cell => {
    cell.classList.remove('density-2', 'density-3', 'density-4', 'density-max');
    const events = cell.querySelector('.events');
    if (!events) return;
    const levels = ['', 'density-2', 'density-3', 'density-4', 'density-max'];
    for (let i = 0; i < levels.length; i++) {
      if (levels[i]) cell.classList.add(levels[i]);
      const fits = events.scrollHeight <= events.clientHeight + 1;
      if (fits) return;
    }
  });
}
function bindAdaptiveDensityResize() {
  let t = null;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(applyAdaptiveDensity, 150);
  });
}

function formatDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startMonth = start.getMonth();
  const startYear = start.getFullYear();
  const endMonth = end.getMonth();
  const endYear = end.getFullYear();
  if (startMonth === endMonth && startYear === endYear) {
    return new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const startMonthStr = new Date(start).toLocaleDateString('en-US', { month: 'long' });
  const endMonthYearStr = new Date(end).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (startYear === endYear) return `${startMonthStr} – ${endMonthYearStr}`;
  const startMonthYearStr = new Date(start).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return `${startMonthYearStr} – ${endMonthYearStr}`;
}

// Backwards-compat aliases
function getPhaseSlug(crew) { return getCrewSlug(crew); }
function getPhaseCode(crew) { return getCrewCode(crew); }
