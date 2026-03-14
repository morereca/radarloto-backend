
import fs from 'fs';
import path from 'path';
import { db } from './db.js';
import { nowIso } from './utils.js';

function normalizeGame(game) {
  if (!['primitiva', 'euromillones'].includes(game)) {
    throw new Error('Juego no válido');
  }
  return game;
}

function dataFileFor(game) {
  const safeGame = normalizeGame(game);
  return path.join(process.cwd(), 'data', `${safeGame}-2016-hoy.json`);
}

function validateRow(game, row) {
  if (!row || typeof row !== 'object') return false;
  if (!row.drawDate || !Array.isArray(row.numbers)) return false;

  if (game === 'primitiva') {
    return row.numbers.length === 6 && Number.isInteger(Number(row.reintegro));
  }
  return row.numbers.length === 5 && Array.isArray(row.stars) && row.stars.length === 2;
}

export function inspectLocalHistoryFiles() {
  const out = {};
  for (const game of ['primitiva', 'euromillones']) {
    const file = dataFileFor(game);
    out[game] = {
      file,
      exists: fs.existsSync(file)
    };
  }
  return out;
}

export function importLocalHistory(game) {
  const file = dataFileFor(game);
  if (!fs.existsSync(file)) {
    throw new Error(`No existe el archivo local para ${game}: ${file}`);
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.draws;

  if (!Array.isArray(rows)) {
    throw new Error(`Formato inválido en ${file}. Debe ser un array o { draws: [...] }`);
  }

  let processed = 0;
  let inserted = 0;

  for (const row of rows) {
    if (!validateRow(game, row)) continue;
    processed += 1;

    const result = db.prepare(`
      INSERT OR IGNORE INTO draws (
        game, draw_date, numbers_json, stars_json, reintegro, source_url, source_name, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      game,
      row.drawDate,
      JSON.stringify(row.numbers.map(Number)),
      game === 'euromillones' ? JSON.stringify(row.stars.map(Number)) : null,
      game === 'primitiva' ? Number(row.reintegro) : null,
      row.sourceUrl || null,
      row.sourceName || 'archivo local',
      nowIso()
    );

    inserted += result.changes;
  }

  return {
    game,
    file,
    processed,
    inserted
  };
}

export function importAllLocalHistory() {
  const primitiva = importLocalHistory('primitiva');
  const euromillones = importLocalHistory('euromillones');
  return { primitiva, euromillones };
}
