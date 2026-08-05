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
// Two sources, freshest valid one wins.
//
//   FAST  - data-v2.json in this repo, refreshed every 5 minutes by a resident
//           job (see .github/workflows/refresh-feed.yml).
//   LEGACY- data.json on the original calendar site, refreshed whenever GitHub
//           feels like honouring its cron (measured median: 94 minutes).
//
// If the fast feed is missing, broken, empty, slow, or somehow older, the
// legacy feed is used and the board behaves exactly like the original site.
// There is no failure mode here that is worse than the original behaviour.
const FAST_FEED_URL   = './data-v2.json';
const LEGACY_FEED_URL = 'https://cassidysmartsheet-ux.github.io/cassidy-tv-calendars/data.json';
const FEED_TIMEOUT_MS = 4000;   // never let a hung fetch freeze a TV

// The fast feed only republishes when the schedule changes (plus a liveness
// beat every 45 min), so its timestamp is "when the data last changed", NOT
// "when we last looked". A quiet morning is not staleness. We therefore trust
// the fast feed outright unless it has gone silent well past its liveness
// beat, which is the only real signal that the job behind it has died.
const FAST_FEED_TRUST_WINDOW_MIN = 90;

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

  const [fast, legacy] = await Promise.allSettled([
    fetchFeed(FAST_FEED_URL, cb),
    fetchFeed(LEGACY_FEED_URL, cb)
  ]);

  const candidates = [];
  if (fast.status   === 'fulfilled') candidates.push({ name: 'fast',   payload: fast.value });
  if (legacy.status === 'fulfilled') candidates.push({ name: 'legacy', payload: legacy.value });

  if (candidates.length === 0) {
    console.warn('[calendar] both feeds unavailable:',
      fast.reason && fast.reason.message, '/', legacy.reason && legacy.reason.message);
    updateFreshnessBadge(null, null);
    return [];
  }

  candidates.sort((a, b) => feedAgeMs(a.payload) - feedAgeMs(b.payload));

  // Prefer the fast feed while it is demonstrably alive; only fall back to
  // whichever feed is freshest once the fast one has missed its liveness beat.
  const fastCandidate = candidates.find(c => c.name === 'fast');
  const fastAlive = fastCandidate &&
    feedAgeMs(fastCandidate.payload) < FAST_FEED_TRUST_WINDOW_MIN * 60 * 1000;
  const chosen = fastAlive ? fastCandidate : candidates[0];
  const ageMin = Math.round(feedAgeMs(chosen.payload) / 60000);
  console.log(`[calendar] using ${chosen.name} feed - ${chosen.payload.events.length} events, ${ageMin} min old (generated ${chosen.payload.generatedAt})`);
  updateFreshnessBadge(chosen.name, ageMin);

  const events = chosen.payload.events.map(e => ({
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
  if (!feedName) { el.textContent = 'feed unavailable'; return; }
  const label = ageMin === 0 ? 'just now' : ageMin + ' min ago';
  el.textContent = `${label} · ${feedName} feed`;
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
