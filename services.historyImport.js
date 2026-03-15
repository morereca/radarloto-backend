import { db } from './db.js';
import { nowIso } from './utils.js';

const API = {
  primitiva: 'https://api.elpais.com/ws/LoteriaPrimitiva',
  euromillones: 'https://api.elpais.com/ws/LoteriaEuromillones'
};

export async function importHistory(game, startYear, endYear) {

  const url = API[game];
  if (!url) throw new Error('Juego no soportado');

  const res = await fetch(url);
  const text = await res.text();

  const json = JSON.parse(text.replace('callback(', '').replace(');',''));

  let inserted = 0;
  let processed = 0;

  for (const row of json) {

    const date = row.fecha_sorteo;
    const year = Number(date.substring(0,4));

    if (year < startYear || year > endYear) continue;

    processed++;

    const numbers = row.combinacion.split('-').map(n => Number(n));

    const stars = row.estrellas
      ? row.estrellas.split('-').map(n => Number(n))
      : null;

    const reintegro = row.reintegro ? Number(row.reintegro) : null;

    const result = db.prepare(`
      INSERT OR IGNORE INTO draws (
        game,
        draw_date,
        numbers_json,
        stars_json,
        reintegro,
        source_url,
        source_name,
        imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      game,
      date,
      JSON.stringify(numbers),
      stars ? JSON.stringify(stars) : null,
      reintegro,
      url,
      'api.elpais.com',
      nowIso()
    );

    inserted += result.changes;
  }

  return {
    game,
    processed,
    inserted
  };
}
