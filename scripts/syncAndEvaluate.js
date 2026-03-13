import { syncOfficial } from '../services.officialSync.js';
import { db } from '../db.js';
import { evaluateTicket } from '../services.evaluator.js';

async function run() {
  const summary = {
    primitiva: null,
    euromillones: null,
    evaluated: 0
  };

  try {
    summary.primitiva = await syncOfficial('primitiva');
  } catch (e) {
    summary.primitiva = { error: String(e.message || e) };
  }

  try {
    summary.euromillones = await syncOfficial('euromillones');
  } catch (e) {
    summary.euromillones = { error: String(e.message || e) };
  }

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

  summary.evaluated = updated;
  console.log('Sync y evaluación completados:', JSON.stringify(summary, null, 2));
}

run().catch((e) => {
  console.error('Error en syncAndEvaluate:', e);
  process.exit(1);
});
