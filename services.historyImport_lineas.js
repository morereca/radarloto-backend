import { db } from './db.js';
import { nowIso } from './utils.js';

const MONTHS = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
};

const YEAR_URL = {
  primitiva: (year) => `https://www.elgordo.com/es/resultados/primitiva--a%C3%B1o-${year}`,
  euromillones: (year) => `https://www.elgordo.com/es/resultados/euromillones--a%C3%B1o-${year}`
};

export async function importHistory(game, startYear, endYear) {
  const years = [];
  for (let year = Number(startYear); year <= Number(endYear); year++) years.push(year);

  let inserted = 0;
  let processed = 0;
  const byYear = [];

  for (const year of years) {
    const url = YEAR_URL[game]?.(year);
    if (!url) throw new Error(`Juego no soportado: ${game}`);

    const html = await fetchText(url);
    const rows = game === 'primitiva' ? parsePrimitivaYear(html) : parseEuroYear(html);

    let insertedYear = 0;
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
        'elGordo.com histórico',
        nowIso()
      );
      inserted += result.changes;
      insertedYear += result.changes;
    }

    byYear.push({ year, fetched: rows.length, inserted: insertedYear, url });
  }

  return { game, startYear, endYear, processed, inserted, byYear };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; RadarLotoBot/1.0; +https://radarloto.com)',
        'accept-language': 'es-ES,es;q=0.9',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'referer': 'https://www.elgordo.com/'
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function stripTags(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(p|div|li|br|h1|h2|h3|section|article|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function normalize(text) {
  return stripTags(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function normalizeMonthName(monthName) {
  return monthName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toIso(day, monthName, year) {
  const month = MONTHS[normalizeMonthName(monthName)];
  if (!month) throw new Error(`Mes no soportado: ${monthName}`);
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.drawDate + '|' + row.numbers.join('-') + '|' + ((row.stars?.join('-')) || (row.reintegro ?? ''));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function linesFromHtml(html) {
  return normalize(html)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePrimitivaYear(html) {
  const lines = linesFromHtml(html);
  const out = [];
  const resultRe = /(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-C(\d{2})\s*-R(\d)/i;
  const dateRe = /(?:lun|mar|mie|mié|jue|vie|sab|sáb|dom),\s*(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/i;

  for (let i = 0; i < lines.length; i += 1) {
    const m1 = lines[i].match(resultRe);
    if (!m1) continue;

    let dateMatch = null;
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j += 1) {
      const m2 = lines[j].match(dateRe);
      if (m2) {
        dateMatch = m2;
        break;
      }
    }
    if (!dateMatch) continue;

    out.push({
      numbers: [m1[1], m1[2], m1[3], m1[4], m1[5], m1[6]].map(Number),
      reintegro: Number(m1[8]),
      drawDate: toIso(dateMatch[1], dateMatch[2], dateMatch[3])
    });
  }

  return dedupe(out);
}

function parseEuroYear(html) {
  const lines = linesFromHtml(html);
  const out = [];
  const resultRe = /(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-E(\d{2})\s*-E(\d{2})/i;
  const dateRe = /(?:lun|mar|mie|mié|jue|vie|sab|sáb|dom),\s*(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/i;

  for (let i = 0; i < lines.length; i += 1) {
    const m1 = lines[i].match(resultRe);
    if (!m1) continue;

    let dateMatch = null;
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j += 1) {
      const m2 = lines[j].match(dateRe);
      if (m2) {
        dateMatch = m2;
        break;
      }
    }
    if (!dateMatch) continue;

    out.push({
      numbers: [m1[1], m1[2], m1[3], m1[4], m1[5]].map(Number),
      stars: [Number(m1[6]), Number(m1[7])],
      drawDate: toIso(dateMatch[1], dateMatch[2], dateMatch[3])
    });
  }

  return dedupe(out);
}
