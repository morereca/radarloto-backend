import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { nowIso } from './utils.js';
import { generatePrimitiva, generateEuromillones, analyze, MODES } from './services.generator.js';
import { evaluateTicket } from './services.evaluator.js';
import { syncOfficial } from './services.officialSync.js';
import { runSyncAndEvaluate } from './sync.service.js';
import { startAutoSyncScheduler } from './autosync.js';
import { getNumberStats, getDrawCoverage } from './services.stats.js';
import { importHistory } from './services.historyImport.js';
import generateSmartRoute from './routes/generate-smart.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  res.json({ modes: MODES });
});

app.post('/api/generate', (req, res) => {
  const game = req.body.game;
  const mode = req.body.mode || 'Números raros';

  if (!['primitiva', 'euromillones'].includes(game)) {
    return res.status(400).json({ error: 'Juego no válido' });
  }

  const draw = game === 'primitiva' ? generatePrimitiva(mode) : generateEuromillones(mode);
  const analysis = analyze(game, draw, mode);

  const createdAt = nowIso();
  const insert = db.prepare(`
    INSERT INTO tickets (
      game, mode, numbers_json, stars_json, reintegro, created_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    game,
    mode,
    JSON.stringify(draw.numbers.map(Number)),
    game === 'euromillones' ? JSON.stringify(draw.stars.map(Number)) : null,
    game === 'primitiva' ? Number(draw.reintegro) : null,
    createdAt
  );

  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(insert.lastInsertRowid);

  res.json({
    ticket,
    generated: draw,
    analysis
  });
});

app.get('/api/tickets', (_req, res) => {
  const tickets = db.prepare(`
    SELECT * FROM tickets
    ORDER BY id DESC
    LIMIT 100
  `).all();
  res.json({ tickets });
});

app.get('/api/feed', (_req, res) => {
  const feed = db.prepare(`
    SELECT id, game, mode, numbers_json, stars_json, reintegro, status, outcome_label, prize_amount, created_at
    FROM tickets
    ORDER BY id DESC
    LIMIT 20
  `).all();
  res.json({ feed });
});

app.get('/api/stats', (_req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_generated,
      SUM(CASE WHEN game = 'primitiva' THEN 1 ELSE 0 END) as primitiva_generated,
      SUM(CASE WHEN game = 'euromillones' THEN 1 ELSE 0 END) as euromillones_generated,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost_count
    FROM tickets
  `).get();

  res.json({ stats: totals });
});

app.get('/api/prize-ranking', (_req, res) => {
  const ranking = db.prepare(`
    SELECT
      game,
      outcome_label,
      prize_amount,
      COUNT(*) as times_given,
      MAX(draw_date) as last_draw_date
    FROM tickets
    WHERE status = 'won'
    GROUP BY game, outcome_label, prize_amount
    ORDER BY times_given DESC, last_draw_date DESC, outcome_label ASC
    LIMIT 20
  `).all();

  res.json({ ranking });
});

app.get('/api/draws', (req, res) => {
  const game = req.query.game;
  if (!game || !['primitiva', 'euromillones'].includes(game)) {
    return res.status(400).json({ error: 'game requerido' });
  }
  const draws = db.prepare(`
    SELECT * FROM draws
    WHERE game = ?
    ORDER BY draw_date DESC
    LIMIT 100
  `).all(game);
  res.json({ draws });
});

app.post('/api/admin/import-draw', (req, res) => {
  const { game, drawDate, numbers, stars, reintegro, sourceUrl } = req.body;
  if (!game || !drawDate || !Array.isArray(numbers)) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  db.prepare(`
    INSERT OR REPLACE INTO draws (
      game, draw_date, numbers_json, stars_json, reintegro, source_url, source_name, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    game,
    drawDate,
    JSON.stringify(numbers),
    stars ? JSON.stringify(stars) : null,
    reintegro ?? null,
    sourceUrl || null,
    sourceUrl ? 'manual+source' : 'manual',
    nowIso()
  );

  res.json({ ok: true });
});

app.post('/api/admin/evaluate-pending', (req, res) => {
  const pending = db.prepare(`
    SELECT * FROM tickets
    WHERE status = 'pending'
    ORDER BY id ASC
  `).all();

  let updated = 0;
  for (const ticket of pending) {
    const draw = db.prepare(`
      SELECT * FROM draws
      WHERE game = ?
      AND draw_date >= date(substr(?, 1, 10))
      ORDER BY draw_date ASC
      LIMIT 1
    `).get(ticket.game, ticket.created_at);

    if (!draw) continue;

    const result = evaluateTicket(ticket, draw);

    db.prepare(`
      UPDATE tickets
      SET
        draw_date = ?,
        main_hits = ?,
        star_hits = ?,
        reintegro_hit = ?,
        outcome_label = ?,
        outcome_detail = ?,
        prize_amount = ?,
        status = ?
      WHERE id = ?
    `).run(
      draw.draw_date,
      result.mainHits,
      result.starHits,
      result.reintegroHit,
      result.label,
      result.detail,
      result.prizeAmount,
      result.won ? 'won' : 'lost',
      ticket.id
    );
    updated += 1;
  }

  res.json({ ok: true, updated });
});

app.post('/api/admin/run-cycle', async (_req, res) => {
  try {
    const summary = await runSyncAndEvaluate();
    res.json({ ok: true, summary });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.post('/api/admin/sync-official', async (req, res) => {
  try {
    const game = req.body.game;
    if (!['primitiva', 'euromillones'].includes(game)) {
      return res.status(400).json({ error: 'Juego no válido' });
    }
    const result = await syncOfficial(game);
    res.json({ ok: true, result });
  } catch (error) {
    db.prepare(`
      INSERT INTO sync_runs (game, status, message, ran_at)
      VALUES (?, ?, ?, ?)
    `).run(req.body.game || 'unknown', 'error', String(error.message || error), nowIso());

    res.status(500).json({ error: String(error.message || error) });
  }
});

app.get('/api/history-coverage', (_req, res) => {
  res.json({
    primitiva: getDrawCoverage('primitiva'),
    euromillones: getDrawCoverage('euromillones')
  });
});

app.get('/api/number-stats', (req, res) => {
  const game = req.query.game;
  if (!game || !['primitiva', 'euromillones'].includes(game)) {
    return res.status(400).json({ error: 'game requerido' });
  }
  const stats = getNumberStats(game);
  res.json({
    game,
    coverage: stats.coverage,
    hot_numbers: stats.hotMain.slice(0, game === 'primitiva' ? 12 : 12),
    cold_numbers: stats.coldMain.slice(0, game === 'primitiva' ? 12 : 12),
    hot_extra: stats.hotExtra.slice(0, 6),
    cold_extra: stats.coldExtra.slice(0, 6),
    main_counts: stats.mainCounts,
    extra_counts: stats.extraCounts
  });
});

app.post('/api/admin/import-history', async (req, res) => {
  try {
    const game = req.body.game;
    if (!['primitiva', 'euromillones'].includes(game)) {
      return res.status(400).json({ error: 'Juego no válido' });
    }
    const year = new Date().getFullYear();
    const defaults = {
      primitiva: { start: 2016, end: year },
      euromillones: { start: 2016, end: year }
    };
    const startYear = Number(req.body.startYear || defaults[game].start);
    const endYear = Number(req.body.endYear || defaults[game].end);

    const result = await importHistory(game, startYear, endYear);
    res.json({ ok: true, result, coverage: getDrawCoverage(game) });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.post('/api/admin/import-history-all', async (_req, res) => {
  try {
    const year = new Date().getFullYear();
    const primitiva = await importHistory('primitiva', 2016, year);
    const euromillones = await importHistory('euromillones', 2016, year);
    res.json({
      ok: true,
      result: { primitiva, euromillones },
      coverage: {
        primitiva: getDrawCoverage('primitiva'),
        euromillones: getDrawCoverage('euromillones')
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.post('/api/admin/import-10-years', async (_req, res) => {
  try {
    const year = new Date().getFullYear();
    const primitiva = await importHistory('primitiva', 2016, year);
    const euromillones = await importHistory('euromillones', 2016, year);
    res.json({
      ok: true,
      result: { primitiva, euromillones },
      coverage: {
        primitiva: getDrawCoverage('primitiva'),
        euromillones: getDrawCoverage('euromillones')
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error.message || error) });
  }
});

app.use(generateSmartRoute);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Radar Loto escuchando en http://localhost:${PORT}`);
  startAutoSyncScheduler();
});
