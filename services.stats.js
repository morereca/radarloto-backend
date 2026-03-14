
import { db } from './db.js';
import { getCachedOfficialNumberStats } from './services.officialStats.js';

const FALLBACK = {
  primitiva: { main: [49, 42, 17, 32, 13, 4, 29, 36, 44, 23, 11, 41], extra: [5, 3, 7, 0, 9, 1] },
  euromillones: { main: [42, 29, 33, 16, 7, 44, 19, 21, 35, 50, 14, 25], extra: [3, 10, 2, 8, 5, 11] }
};

function range(start, end){
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function getDrawCoverage(game){
  const row = db.prepare(`
    SELECT COUNT(*) as total, MIN(draw_date) as first_date, MAX(draw_date) as last_date
    FROM draws WHERE game = ?
  `).get(game);
  return row || { total: 0, first_date: null, last_date: null };
}

export function getNumberStats(game){
  const coverage = getDrawCoverage(game);
  if (Number(coverage.total || 0) < 50) {
    const cached = getCachedOfficialNumberStats(game);
    if (cached) {
      return {
        game,
        coverage: cached.coverage || coverage,
        mainCounts: cached.mainCounts || {},
        extraCounts: cached.extraCounts || {},
        hotMain: cached.hotMain || FALLBACK[game].main,
        coldMain: cached.coldMain || [...FALLBACK[game].main].reverse(),
        hotExtra: cached.hotExtra || FALLBACK[game].extra,
        coldExtra: cached.coldExtra || [...FALLBACK[game].extra].reverse(),
        source: 'official-cache'
      };
    }
  }

  const draws = db.prepare(`
    SELECT numbers_json, stars_json, reintegro
    FROM draws
    WHERE game = ?
    ORDER BY draw_date DESC
  `).all(game);

  const mainMax = game === 'primitiva' ? 49 : 50;
  const extraMax = game === 'primitiva' ? 9 : 12;

  const mainCounts = Object.fromEntries(range(1, mainMax).map(n => [n, 0]));
  const extraCounts = Object.fromEntries(range(game === 'primitiva' ? 0 : 1, extraMax).map(n => [n, 0]));
  const lastSeenMain = Object.fromEntries(range(1, mainMax).map(n => [n, null]));
  const lastSeenExtra = Object.fromEntries(range(game === 'primitiva' ? 0 : 1, extraMax).map(n => [n, null]));

  draws.forEach((draw, index) => {
    const main = JSON.parse(draw.numbers_json || '[]').map(Number);
    for (const n of main) {
      if (n in mainCounts) {
        mainCounts[n] += 1;
        if (lastSeenMain[n] === null) lastSeenMain[n] = index;
      }
    }

    if (game === 'euromillones') {
      const stars = JSON.parse(draw.stars_json || '[]').map(Number);
      for (const s of stars) {
        if (s in extraCounts) {
          extraCounts[s] += 1;
          if (lastSeenExtra[s] === null) lastSeenExtra[s] = index;
        }
      }
    } else {
      const r = Number(draw.reintegro);
      if (!Number.isNaN(r) && r in extraCounts) {
        extraCounts[r] += 1;
        if (lastSeenExtra[r] === null) lastSeenExtra[r] = index;
      }
    }
  });

  const hotMain = sortCountMap(mainCounts, 'desc').map(x => Number(x.key));
  const coldMain = sortColdMap(mainCounts, lastSeenMain).map(x => Number(x.key));
  const hotExtra = sortCountMap(extraCounts, 'desc').map(x => Number(x.key));
  const coldExtra = sortColdMap(extraCounts, lastSeenExtra).map(x => Number(x.key));

  const coverage = getDrawCoverage(game);

  return {
    game,
    coverage,
    mainCounts,
    extraCounts,
    hotMain: hotMain.length ? hotMain : FALLBACK[game].main,
    coldMain: coldMain.length ? coldMain : [...FALLBACK[game].main].reverse(),
    hotExtra: hotExtra.length ? hotExtra : FALLBACK[game].extra,
    coldExtra: coldExtra.length ? coldExtra : [...FALLBACK[game].extra].reverse()
  };
}

function sortCountMap(map, direction){
  return Object.entries(map).sort((a, b) => {
    const da = Number(a[1]);
    const db = Number(b[1]);
    if (direction === 'desc') return db - da || Number(a[0]) - Number(b[0]);
    return da - db || Number(a[0]) - Number(b[0]);
  });
}

function sortColdMap(counts, lastSeen){
  return Object.keys(counts).map(key => ({
    key,
    count: Number(counts[key] || 0),
    gap: lastSeen[key] === null ? Number.MAX_SAFE_INTEGER : Number(lastSeen[key])
  })).sort((a, b) => {
    if (a.count === 0 && b.count !== 0) return -1;
    if (b.count === 0 && a.count !== 0) return 1;
    return b.gap - a.gap || a.count - b.count || Number(a.key) - Number(b.key);
  });
}
