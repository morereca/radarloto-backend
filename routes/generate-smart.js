import express from "express";
import { db } from "../db.js";
import { nowIso } from "../utils.js";
import { generatePrimitiva, generateEuromillones, analyze } from "../services.generator.js";

const router = express.Router();

router.post("/api/generate-smart", (req, res) => {
  const game = req.body.game;
  const rawMode = req.body.mode || "radar_ai";

  if (!["primitiva", "euromillones"].includes(game)) {
    return res.status(400).json({ error: "Juego no válido" });
  }

  const mode = rawMode === "radar_ai" ? "Radar Loto IA" : rawMode;

  const draw =
    game === "primitiva"
      ? generatePrimitiva(mode)
      : generateEuromillones(mode);

  const analysis = analyze(game, draw, mode);
  const createdAt = nowIso();

  const insert = db.prepare(`
    INSERT INTO tickets (
      game,
      mode,
      numbers_json,
      stars_json,
      reintegro,
      created_at,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    game,
    mode,
    JSON.stringify((draw.numbers || []).map(Number)),
    game === "euromillones" ? JSON.stringify((draw.stars || []).map(Number)) : null,
    game === "primitiva" ? Number(draw.reintegro) : null,
    createdAt
  );

  const ticket = db.prepare(`
    SELECT * FROM tickets
    WHERE id = ?
  `).get(insert.lastInsertRowid);

  res.json({
    ok: true,
    ticket,
    result: draw,
    generated: draw,
    analysis
  });
});

export default router;
