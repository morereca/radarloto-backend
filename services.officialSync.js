import { db } from './db.js';
import { nowIso } from './utils.js';

const OFFICIAL_URLS = {
  euromillones: 'https://www.loteriasyapuestas.es/es/euromillones/resultados/.formatoRSS',
  primitiva: 'https://www.loteriasyapuestas.es/es/la-primitiva/resultados/.formatoRSS'
};

export async function syncOfficial(game) {
  const url = OFFICIAL_URLS[game];
  if (!url) throw new Error('Juego no soportado para sync oficial');

  const res = await fetch(url, {
    headers: {
      'user-agent': 'RadarLoto/2.0 (+https://radarloto-backend-production.up.railway.app)'
    }
  });

  if (!res.ok) {
    throw new Error(`No se pudo leer la fuente oficial: ${res.status}`);
  }

  const xml = await res.text();
  const parsed = parseOfficialRss(game, xml);

  if (!parsed.length) {
    db.prepare(`
      INSERT INTO sync_runs (game, status, message, ran_at)
      VALUES (?, ?, ?, ?)
    `).run(game, 'warning', 'No se pudieron extraer sorteos desde el RSS oficial.', nowIso());

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
      'SELAE RSS',
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

function parseOfficialRss(game, xml) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((m) => m[0])
    .map((itemXml) => parseItem(game, itemXml))
    .filter(Boolean);

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.drawDate}:${item.numbers.join('-')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseItem(game, itemXml) {
  const title = decodeXml(stripTags(extractTag(itemXml, 'title') || ''));
  const description = decodeXml(stripTags(extractTag(itemXml, 'description') || ''));
  const encoded = decodeXml(stripTags(extractTag(itemXml, 'content:encoded') || ''));
  const pubDate = decodeXml(stripTags(extractTag(itemXml, 'pubDate') || ''));
  const text = [title, description, encoded, pubDate].filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim();

  const drawDate = extractDate(text, pubDate);
  if (!drawDate) return null;

  if (game === 'primitiva') {
    const reintegro = extractExplicitNumber(text, /reintegro\D{0,12}(\d{1,2})/i);
    const complementario = extractExplicitNumber(text, /complementario\D{0,12}(\d{1,2})/i);
    let candidates = extractNumbers(text).filter((n) => n >= 1 && n <= 49);
    candidates = removeDateNoise(candidates, drawDate);

    const numbers = uniqueOrdered(candidates).slice(0, 6);
    if (numbers.length !== 6) return null;

    return {
      drawDate,
      numbers,
      reintegro: reintegro ?? null,
      complementario: complementario ?? null
    };
  }

  if (game === 'euromillones') {
    const starsExplicit = extractSectionNumbers(text, /estrellas?([^|]+)/i, 12);
    let candidates = extractNumbers(text).filter((n) => n >= 1 && n <= 50);
    candidates = removeDateNoise(candidates, drawDate);

    let stars = uniqueOrdered(starsExplicit).slice(0, 2);
    let mainCandidates = candidates;

    if (stars.length) {
      const starSet = new Set(stars);
      mainCandidates = candidates.filter((n, idx) => idx < 5 || !starSet.has(n));
    }

    const numbers = uniqueOrdered(mainCandidates).slice(0, 5);

    if (!stars.length) {
      const tail = [...candidates].reverse().filter((n) => n >= 1 && n <= 12);
      stars = uniqueOrdered(tail).slice(0, 2).reverse();
    }

    if (numbers.length !== 5 || stars.length !== 2) return null;

    return {
      drawDate,
      numbers,
      stars
    };
  }

  return null;
}

function extractTag(xml, tagName) {
  const escaped = tagName.replace(':', '\\:');
  const m = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return m ? m[1] : null;
}

function stripTags(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ');
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractNumbers(text) {
  return (text.match(/\b\d{1,2}\b/g) || []).map(Number);
}

function extractExplicitNumber(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  return Number(m[1]);
}

function extractSectionNumbers(text, regex, max) {
  const m = text.match(regex);
  if (!m) return [];
  return uniqueOrdered(extractNumbers(m[1]).filter((n) => n >= 1 && n <= max));
}

function extractDate(text, pubDate) {
  const iso = text.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const es = text.match(/(\d{2})[\/\-](\d{2})[\/\-](20\d{2})/);
  if (es) return `${es[3]}-${es[2]}-${es[1]}`;

  if (pubDate) {
    const date = new Date(pubDate);
    if (!Number.isNaN(date.getTime())) {
      const yyyy = date.getUTCFullYear();
      const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(date.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  }

  return null;
}

function removeDateNoise(numbers, drawDate) {
  const [, mm, dd] = drawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  if (!mm || !dd) return numbers;
  const month = Number(mm);
  const day = Number(dd);

  let removedDay = false;
  let removedMonth = false;

  return numbers.filter((n) => {
    if (!removedDay && n === day) {
      removedDay = true;
      return false;
    }
    if (!removedMonth && n === month) {
      removedMonth = true;
      return false;
    }
    return true;
  });
}

function uniqueOrdered(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
