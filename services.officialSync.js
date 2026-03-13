import * as cheerio from 'cheerio';
import { db } from './db.js';
import { nowIso } from './utils.js';

const OFFICIAL_URLS = {
  euromillones: 'https://www.loteriasyapuestas.es/es/resultados/euromillones',
  primitiva: 'https://www.loteriasyapuestas.es/es/resultados/primitiva'
};

export async function syncOfficial(game) {
  const url = OFFICIAL_URLS[game];
  if (!url) throw new Error('Juego no soportado para sync oficial');

  const res = await fetch(url, { headers: { 'user-agent': 'RadarLoto/1.0' } });
  if (!res.ok) throw new Error(`No se pudo leer la fuente oficial: ${res.status}`);

  const html = await res.text();
  const parsed = parseOfficialPage(game, html, url);

  if (!parsed.length) {
    db.prepare(`
      INSERT INTO sync_runs (game, status, message, ran_at)
      VALUES (?, ?, ?, ?)
    `).run(game, 'warning', 'No se pudieron extraer sorteos automáticamente. Revisa el adaptador.', nowIso());

    return { processed: 0, inserted: 0, sourceUrl: url, warning: true };
  }

  let inserted = 0;
  for (const draw of parsed) {
    const result = db.prepare(`
      INSERT OR IGNORE INTO draws (
        game, draw_date, numbers_json, stars_json, reintegro, source_url, source_name, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      game,
      draw.drawDate,
      JSON.stringify(draw.numbers),
      draw.stars ? JSON.stringify(draw.stars) : null,
      draw.reintegro ?? null,
      url,
      'SELAE',
      nowIso()
    );
    inserted += result.changes;
  }

  db.prepare(`
    INSERT INTO sync_runs (game, status, message, ran_at)
    VALUES (?, ?, ?, ?)
  `).run(game, 'ok', `Sorteos procesados: ${parsed.length}. Insertados: ${inserted}`, nowIso());

  return { processed: parsed.length, inserted, sourceUrl: url };
}

function parseOfficialPage(game, html, sourceUrl) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  // 1) Intento por selectores "visuales" si la página los expone.
  const selectorDraws = parseBySelectors(game, $);
  if (selectorDraws.length) return selectorDraws;

  // 2) Fallback robusto por ventanas de texto.
  const windowDraws = parseByTextWindows(game, text);
  if (windowDraws.length) return windowDraws;

  // 3) Último recurso: intentar leer JSON incrustado.
  return parseByEmbeddedJson(game, html);
}

function parseBySelectors(game, $) {
  const draws = [];
  const seen = new Set();

  const candidateBlocks = [
    '[class*="resultado"]',
    '[class*="draw"]',
    '[class*="sorteo"]',
    'article',
    'section',
    'li'
  ];

  for (const sel of candidateBlocks) {
    $(sel).each((_, el) => {
      const blockText = $(el).text().replace(/\s+/g, ' ').trim();
      const draw = parseSingleBlock(game, blockText);
      if (!draw) return;
      if (seen.has(draw.drawDate)) return;
      draws.push(draw);
      seen.add(draw.drawDate);
    });
    if (draws.length) break;
  }

  return draws;
}

function parseByTextWindows(game, text) {
  const draws = [];
  const seen = new Set();
  const dateRegex = /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g;
  let m;

  while ((m = dateRegex.exec(text)) !== null) {
    const dd = m[1], mm = m[2], yyyy = m[3];
    const drawDate = `${yyyy}-${mm}-${dd}`;
    if (seen.has(drawDate)) continue;

    const windowText = text.slice(m.index, m.index + 500);
    const draw = parseSingleBlock(game, windowText, drawDate);
    if (!draw) continue;

    draws.push(draw);
    seen.add(draw.drawDate);
  }

  return draws;
}

function parseByEmbeddedJson(game, html) {
  const draws = [];
  const seen = new Set();

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of scripts) {
    const body = s[1];
    const dates = [...body.matchAll(/(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/g)];
    for (const d of dates) {
      const draw = parseSingleBlock(game, body.slice(d.index, d.index + 500));
      if (!draw) continue;
      if (seen.has(draw.drawDate)) continue;
      draws.push(draw);
      seen.add(draw.drawDate);
    }
  }

  return draws;
}

function parseSingleBlock(game, blockText, forcedDate = null) {
  const drawDate = forcedDate || extractDate(blockText);
  if (!drawDate) return null;

  const nums = (blockText.match(/\b\d{1,2}\b/g) || []).map(Number);
  if (!nums.length) return null;

  if (game === 'euromillones') {
    const mainCandidates = nums.filter((n) => n >= 1 && n <= 50);
    if (mainCandidates.length < 7) return null;

    // Quitamos valores de fecha si aparecen al principio.
    const cleaned = stripDateNoise(mainCandidates);
    if (cleaned.length < 7) return null;

    const numbers = uniqueOrdered(cleaned.filter((n) => n >= 1 && n <= 50)).slice(0, 5);
    const remaining = cleaned.filter((n) => !numbers.includes(n) || countInArray(numbers, n) < countInArray(cleaned.slice(0, 5), n));
    const starPool = uniqueOrdered(remaining.filter((n) => n >= 1 && n <= 12));
    const stars = starPool.slice(0, 2);

    if (numbers.length !== 5 || stars.length !== 2) return null;
    return { drawDate, numbers, stars };
  }

  const mainCandidates = nums.filter((n) => n >= 0 && n <= 49);
  if (mainCandidates.length < 7) return null;

  const cleaned = stripDateNoise(mainCandidates);
  if (cleaned.length < 7) return null;

  const numbers = uniqueOrdered(cleaned.filter((n) => n >= 1 && n <= 49)).slice(0, 6);
  const tail = cleaned.filter((n) => !numbers.includes(n) || countInArray(numbers, n) < countInArray(cleaned.slice(0, 6), n));
  const reintegro = tail.find((n) => n >= 0 && n <= 9) ?? null;

  if (numbers.length !== 6) return null;
  return { drawDate, numbers, reintegro };
}

function extractDate(text) {
  const m1 = text.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;

  const m2 = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  return null;
}

function stripDateNoise(arr) {
  const copy = [...arr];
  if (copy.length >= 3) {
    // muchos bloques empiezan con dd mm yyyy(2 últimos dígitos) o dd mm
    copy.shift();
    copy.shift();
  }
  return copy;
}

function uniqueOrdered(arr) {
  const out = [];
  for (const n of arr) if (!out.includes(n)) out.push(n);
  return out;
}

function countInArray(arr, value) {
  return arr.filter((x) => x === value).length;
}
