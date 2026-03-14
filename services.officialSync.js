import { db } from './db.js';
import { nowIso } from './utils.js';

const GAME_CONFIG = {
  euromillones: {
    url: 'https://www.elgordo.com/es/resultados/euromillones',
    sourceName: 'elGordo.com resultados'
  },
  primitiva: {
    url: 'https://www.elgordo.com/es/resultados/primitiva',
    sourceName: 'elGordo.com resultados'
  }
};

const MONTHS = {
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12'
};

export async function syncOfficial(game) {
  const cfg = GAME_CONFIG[game];
  if (!cfg) throw new Error('Juego no soportado para sync oficial');

  const html = await fetchText(cfg.url);
  const draw = parseLatestDraw(game, html, cfg.url);

  if (!draw) {
    throw new Error(`No se pudo extraer el último sorteo de ${game}`);
  }

  const result = db.prepare(`
    INSERT OR REPLACE INTO draws (
      game, draw_date, numbers_json, stars_json, reintegro, source_url, source_name, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    game,
    draw.drawDate,
    JSON.stringify(draw.numbers),
    draw.stars ? JSON.stringify(draw.stars) : null,
    draw.reintegro ?? null,
    draw.sourceUrl,
    cfg.sourceName,
    nowIso()
  );

  db.prepare(`
    INSERT INTO sync_runs (game, status, message, ran_at)
    VALUES (?, ?, ?, ?)
  `).run(game, 'ok', `Último sorteo sincronizado: ${draw.drawDate}`, nowIso());

  return { processed: 1, inserted: result.changes, latest: draw };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'RadarLoto/5.2 (+https://radarloto-backend-production.up.railway.app)',
        'accept-language': 'es-ES,es;q=0.9',
        'accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function parseLatestDraw(game, html, sourceUrl) {
  const text = normalizeText(stripTags(html));

  if (game === 'euromillones') {
    return parseEuro(text, sourceUrl);
  }
  if (game === 'primitiva') {
    return parsePrimitiva(text, sourceUrl);
  }
  return null;
}

function parseEuro(text, sourceUrl) {
  // Example:
  // "Último Resultado Anterior martes, 10 marzo 2026 12 14 27 44 50 4 12 Categoría..."
  const m = text.match(/Último Resultado(?:\s+Anterior)?\s+([a-záéíóú]+),\s+(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})\s+((?:\d{1,2}\s+){6}\d{1,2})\s+Categoría/i);
  if (!m) return null;

  const drawDate = toIsoDate(m[2], m[3], m[4]);
  const parts = m[5].trim().split(/\s+/).map(Number);
  if (parts.length < 7) return null;

  const numbers = parts.slice(0, 5);
  const stars = parts.slice(5, 7);

  if (numbers.length !== 5 || stars.length !== 2) return null;
  return { drawDate, numbers, stars, sourceUrl };
}

function parsePrimitiva(text, sourceUrl) {
  // Example:
  // "Último Resultado Anterior jueves, 12 marzo 2026 5 12 16 22 29 36 26 C 2 R Categoría..."
  const m = text.match(/Último Resultado(?:\s+Anterior)?\s+([a-záéíóú]+),\s+(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})\s+((?:\d{1,2}\s+){5}\d{1,2})\s+(\d{1,2})\s+C\s+(\d{1,2})\s+R\s+Categoría/i);
  if (!m) return null;

  const drawDate = toIsoDate(m[2], m[3], m[4]);
  const numbers = m[5].trim().split(/\s+/).map(Number);
  const reintegro = Number(m[7]);

  if (numbers.length !== 6 || Number.isNaN(reintegro)) return null;
  return { drawDate, numbers, reintegro, sourceUrl };
}

function toIsoDate(day, monthName, year) {
  const month = MONTHS[normalizeMonth(monthName)];
  if (!month) throw new Error(`Mes no soportado: ${monthName}`);
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function normalizeMonth(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function stripTags(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeText(text) {
  return decodeHtml(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
