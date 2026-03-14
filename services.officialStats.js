
import { db } from './db.js';
import { nowIso } from './utils.js';

const URLS = {
  primitiva: 'https://www.loteriasyapuestas.es/es/la-primitiva/estadisticas',
  euromillones: 'https://www.loteriasyapuestas.es/es/euromillones/estadisticas'
};

function normalize(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(p|div|li|br|h1|h2|h3|section|article|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'RadarLoto/official-stats (+https://radarloto-backend-production.up.railway.app)',
        'accept-language': 'es-ES,es;q=0.9',
        'accept': 'text/html,application/xhtml+xml'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseCoverage(text, game) {
  const m = text.match(/TOTAL\s*:\s*Total histórico[^\d]*(\d+)/i);
  const total = m ? Number(m[1]) : null;
  return {
    total,
    first_date: null,
    last_date: null,
    source: URLS[game]
  };
}

function parseMainCounts(text, game) {
  const lines = normalize(text).split('\n').map(s => s.trim()).filter(Boolean);
  const out = {};
  const maxMain = game === 'primitiva' ? 49 : 50;
  for (let i = 1; i <= maxMain; i++) out[i] = 0;

  let started = false;
  for (const line of lines) {
    if (!started && /Por Número/i.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;

    const m = line.match(/^(\d{1,2})\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      const total = Number(m[2]);
      if (n >= 1 && n <= maxMain) out[n] = total;
      continue;
    }

    if (started && /TOTAL\s*:/.test(line)) break;
  }

  return out;
}

function sortCountMap(map, direction) {
  return Object.entries(map).sort((a, b) => {
    const da = Number(a[1] || 0);
    const db = Number(b[1] || 0);
    if (direction === 'desc') return db - da || Number(a[0]) - Number(b[0]);
    return da - db || Number(a[0]) - Number(b[0]);
  });
}

function buildStats(game, html) {
  const counts = parseMainCounts(html, game);
  const coverage = parseCoverage(html, game);
  const hotMain = sortCountMap(counts, 'desc').map(([key]) => Number(key));
  const coldMain = sortCountMap(counts, 'asc').map(([key]) => Number(key));

  return {
    game,
    coverage,
    mainCounts: counts,
    extraCounts: {},
    hotMain,
    coldMain,
    hotExtra: [],
    coldExtra: [],
    sourceUrl: URLS[game],
    fetchedAt: nowIso()
  };
}

export async function fetchOfficialNumberStats(game) {
  if (!['primitiva', 'euromillones'].includes(game)) {
    throw new Error('Juego no válido');
  }
  const html = await fetchText(URLS[game]);
  return buildStats(game, html);
}

export function getCachedOfficialNumberStats(game) {
  const row = db.prepare(`
    SELECT payload_json, fetched_at
    FROM official_stats_cache
    WHERE game = ?
  `).get(game);

  if (!row) return null;
  const payload = JSON.parse(row.payload_json);
  payload.cachedAt = row.fetched_at;
  return payload;
}

export async function refreshOfficialNumberStatsCache(game) {
  const payload = await fetchOfficialNumberStats(game);
  db.prepare(`
    INSERT INTO official_stats_cache (game, payload_json, source_url, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(game) DO UPDATE SET
      payload_json = excluded.payload_json,
      source_url = excluded.source_url,
      fetched_at = excluded.fetched_at
  `).run(game, JSON.stringify(payload), payload.sourceUrl, nowIso());
  return getCachedOfficialNumberStats(game);
}

export async function refreshAllOfficialNumberStatsCache() {
  const primitiva = await refreshOfficialNumberStatsCache('primitiva');
  const euromillones = await refreshOfficialNumberStatsCache('euromillones');
  return { primitiva, euromillones };
}
