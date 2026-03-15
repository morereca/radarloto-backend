import { db } from './db.js';
import { nowIso } from './utils.js';

// Fuente estable con históricos descargables en CSV.
// Primitiva: CSV 2013-2026 en Google Sheets publicado por Lotoideas.
// Euromillones: CSV histórico completo en Google Sheets publicado por Lotoideas.
const CSV_URLS = {
  primitiva: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTov1BuA0nkVGTS48arpPFkc9cG7B40Xi3BfY6iqcWTrMwCBg5b50-WwvnvaR6mxvFHbDBtYFKg5IsJ/pub?gid=1&output=csv&single=true',
  euromillones: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRy91wfK2JteoMi1ZOhGm0D1RKJfDTbEOj6rfnrB6-X7n2Q1nfFwBZBpcivHRdg3pSwxSQgLA3KpW7v/pub?output=csv'
};

export async function importHistory(game, startYear, endYear) {
  const url = CSV_URLS[game];
  if (!url) throw new Error(`Juego no soportado: ${game}`);

  const csv = await fetchText(url);
  const rows = parseCsvHistory(game, csv, Number(startYear), Number(endYear));

  let processed = 0;
  let inserted = 0;

  for (const row of rows) {
    processed += 1;
    const result = db.prepare(`
      INSERT OR IGNORE INTO draws (
        game, draw_date, numbers_json, stars_json, reintegro, source_url, source_name, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      game,
      row.drawDate,
      JSON.stringify(row.numbers),
      row.stars ? JSON.stringify(row.stars) : null,
      row.reintegro ?? null,
      url,
      'Lotoideas CSV histórico',
      nowIso()
    );

    inserted += result.changes;
  }

  return {
    game,
    startYear: Number(startYear),
    endYear: Number(endYear),
    processed,
    inserted,
    byYear: summarizeByYear(rows, startYear, endYear)
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; RadarLotoBot/1.0; +https://radarloto.com)',
        'accept': 'text/csv,text/plain;q=0.9,*/*;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeByYear(rows, startYear, endYear) {
  const out = [];
  for (let year = Number(startYear); year <= Number(endYear); year += 1) {
    const count = rows.filter(r => Number(r.drawDate.slice(0, 4)) === year).length;
    out.push({ year, fetched: count, inserted: 0 });
  }
  return out;
}

function parseCsvHistory(game, csv, startYear, endYear) {
  const lines = csv
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const out = [];
  for (const line of lines) {
    const row = parseCsvLine(game, line);
    if (!row) continue;

    const year = Number(row.drawDate.slice(0, 4));
    if (year < startYear || year > endYear) continue;

    out.push(row);
  }

  return dedupe(out);
}

function parseCsvLine(game, line) {
  const date = extractDate(line);
  if (!date) return null;

  const numberTokens = extractNumbersAfterDate(line, date.original);
  if (game === 'primitiva') {
    if (numberTokens.length < 6) return null;

    return {
      drawDate: date.iso,
      numbers: numberTokens.slice(0, 6),
      // Esta fuente no garantiza reintegro histórico en todas las filas.
      reintegro: null
    };
  }

  if (numberTokens.length < 7) return null;
  return {
    drawDate: date.iso,
    numbers: numberTokens.slice(0, 5),
    stars: numberTokens.slice(5, 7)
  };
}

function extractDate(line) {
  // yyyy-mm-dd
  let m = line.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return {
      original: m[0],
      iso: `${m[1]}-${m[2]}-${m[3]}`
    };
  }

  // dd/mm/yyyy or d/m/yyyy
  m = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return {
      original: m[0],
      iso: `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
    };
  }

  // dd-mm-yyyy
  m = line.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) {
    return {
      original: m[0],
      iso: `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`
    };
  }

  return null;
}

function extractNumbersAfterDate(line, dateString) {
  const idx = line.indexOf(dateString);
  const tail = idx >= 0 ? line.slice(idx + dateString.length) : line;

  return (tail.match(/\d{1,2}/g) || [])
    .map(n => Number(n))
    .filter(n => Number.isFinite(n));
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.drawDate + '|' + row.numbers.join('-') + '|' + ((row.stars?.join('-')) || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
