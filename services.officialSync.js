
import { db } from './db.js';
import { nowIso } from './utils.js';

const GAME_CONFIG = {
  euromillones: {
    listUrl: 'https://www.loteriasyapuestas.es/es/euromillones/resultados',
    basePath: '/es/euromillones/resultados/',
    sourceName: 'SELAE resultados oficiales'
  },
  primitiva: {
    listUrl: 'https://www.loteriasyapuestas.es/es/la-primitiva/resultados',
    basePath: '/es/la-primitiva/resultados/',
    sourceName: 'SELAE resultados oficiales'
  }
};

export async function syncOfficial(game) {
  const cfg = GAME_CONFIG[game];
  if (!cfg) throw new Error('Juego no soportado para sync oficial');

  const listHtml = await fetchText(cfg.listUrl);
  const detailUrls = extractDetailUrls(listHtml, cfg.basePath).slice(0, 12);

  if (!detailUrls.length) {
    throw new Error('No se encontraron enlaces de resultados oficiales');
  }

  const parsed = [];
  for (const detailUrl of detailUrls) {
    try {
      const detailHtml = await fetchText(detailUrl);
      const draw = parseOfficialDetail(game, detailHtml, detailUrl);
      if (draw) parsed.push(draw);
    } catch (error) {
      db.prepare(`
        INSERT INTO sync_runs (game, status, message, ran_at)
        VALUES (?, ?, ?, ?)
      `).run(game, 'warning', `No se pudo procesar ${detailUrl}: ${String(error.message || error)}`, nowIso());
    }
  }

  if (!parsed.length) {
    db.prepare(`
      INSERT INTO sync_runs (game, status, message, ran_at)
      VALUES (?, ?, ?, ?)
    `).run(game, 'warning', 'No se pudieron extraer sorteos desde las páginas oficiales.', nowIso());

    return { processed: 0, inserted: 0, sourceUrl: cfg.listUrl, warning: true };
  }

  let inserted = 0;
  for (const draw of parsed) {
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
    inserted += result.changes;
  }

  db.prepare(`
    INSERT INTO sync_runs (game, status, message, ran_at)
    VALUES (?, ?, ?, ?)
  `).run(game, 'ok', `Sorteos procesados: ${parsed.length}. Insertados/actualizados: ${inserted}`, nowIso());

  return { processed: parsed.length, inserted, sourceUrl: cfg.listUrl };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'RadarLoto/5.1 (+https://radarloto-backend-production.up.railway.app)',
        'accept-language': 'es-ES,es;q=0.9'
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

function extractDetailUrls(html, basePath) {
  const urls = new Set();
  const hrefRegex = /href="([^"]+)"/gi;
  let m;
  while ((m = hrefRegex.exec(html))) {
    const href = decodeXml(m[1]);
    if (!href.includes(basePath)) continue;
    if (href === basePath.slice(0, -1)) continue;
    if (/\/comprobar/.test(href)) continue;
    const abs = href.startsWith('http')
      ? href
      : `https://www.loteriasyapuestas.es${href.startsWith('/') ? '' : '/'}${href}`;
    urls.add(abs);
  }
  return Array.from(urls);
}

function parseOfficialDetail(game, html, sourceUrl) {
  const text = normalizeText(stripTags(html));

  if (game === 'euromillones') {
    const drawDate = extractDate(text);
    const line = text.match(/combinación ganadora ha correspondido a los siguientes números:\s*(\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2})\s*Estrellas:\s*(\d{1,2})\s*-\s*(\d{1,2})/i);
    if (!drawDate || !line) return null;

    const numbers = line[1].split('-').map(s => Number(s.trim()));
    const stars = [Number(line[2]), Number(line[3])];
    if (numbers.length !== 5 || stars.length !== 2) return null;

    return { drawDate, numbers, stars, sourceUrl };
  }

  if (game === 'primitiva') {
    const drawDate = extractDate(text);
    const line = text.match(/combinación ganadora ha correspondido a los siguientes números:\s*(\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{1,2})([\s\S]*?)$/i);
    if (!drawDate || !line) return null;

    const numbers = line[1].split('-').map(s => Number(s.trim()));
    const reintegroMatch = text.match(/Reintegro:\s*R\((\d{1,2})\)/i);
    const reintegro = reintegroMatch ? Number(reintegroMatch[1]) : null;
    if (numbers.length !== 6) return null;

    return { drawDate, numbers, reintegro, sourceUrl };
  }

  return null;
}

function stripTags(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeText(text) {
  return decodeXml(text)
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractDate(text) {
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
