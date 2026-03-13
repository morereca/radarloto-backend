
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
  for (const year of years) {
    const url = YEAR_URL[game]?.(year);
    if (!url) throw new Error(`Juego no soportado: ${game}`);

    const html = await fetchText(url);
    const rows = game === 'primitiva' ? parsePrimitivaYear(html) : parseEuroYear(html);

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
    }
  }

  return { game, startYear, endYear, processed, inserted };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'RadarLoto/6.0 (+https://radarloto-backend-production.up.railway.app)',
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

function stripTags(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalize(text) {
  return stripTags(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePrimitivaYear(html) {
  const text = normalize(html);
  const out = [];
  const regex = /(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-C(\d{2})\s+-R(\d)\s+([a-záéíóú]{3,4}),\s+(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    out.push({
      numbers: m.slice(1, 7).map(Number),
      reintegro: Number(m[8]),
      drawDate: toIso(m[10], m[11], m[12])
    });
  }
  return dedupe(out);
}

function parseEuroYear(html) {
  const text = normalize(html);
  const out = [];
  const regex = /(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-E(\d{2})\s+-E(\d{2})\s+([a-záéíóú]{3,4}),\s+(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    out.push({
      numbers: m.slice(1, 6).map(Number),
      stars: [Number(m[6]), Number(m[7])],
      drawDate: toIso(m[9], m[10], m[11])
    });
  }
  return dedupe(out);
}

function toIso(day, monthName, year) {
  const key = monthName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = MONTHS[key];
  if (!month) throw new Error(`Mes no soportado: ${monthName}`);
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.drawDate + '|' + row.numbers.join('-') + '|' + (row.stars?.join('-') || row.reintegro ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
