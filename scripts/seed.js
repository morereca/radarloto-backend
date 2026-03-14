import { db } from '../db.js';
import { nowIso } from '../utils.js';

const draws = [
  {
    game: 'euromillones',
    draw_date: '2026-03-10',
    numbers: [12, 14, 27, 44, 50],
    stars: [4, 12]
  },
  {
    game: 'euromillones',
    draw_date: '2026-03-06',
    numbers: [8, 19, 34, 41, 46],
    stars: [3, 10]
  },
  {
    game: 'primitiva',
    draw_date: '2026-03-12',
    numbers: [4, 11, 23, 34, 41, 48],
    reintegro: 7
  },
  {
    game: 'primitiva',
    draw_date: '2026-03-09',
    numbers: [5, 17, 29, 36, 44, 48],
    reintegro: 3
  }
];

for (const d of draws) {
  db.prepare(`
    INSERT OR IGNORE INTO draws (
      game, draw_date, numbers_json, stars_json, reintegro, source_url, source_name, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    d.game,
    d.draw_date,
    JSON.stringify(d.numbers),
    d.stars ? JSON.stringify(d.stars) : null,
    d.reintegro ?? null,
    null,
    'seed',
    nowIso()
  );
}

console.log('Seed completado');