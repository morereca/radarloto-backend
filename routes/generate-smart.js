import express from 'express';
import { getNumberStats } from '../services.stats.js';
import { generateSmartNumbers } from '../smart.generator.js';

const router = express.Router();

function buildStats(game) {
  const internalStats = getNumberStats(game);
  return {
    hotMain: internalStats.hotMain || [],
    coldMain: internalStats.coldMain || [],
    hotExtra: internalStats.hotExtra || [],
    coldExtra: internalStats.coldExtra || [],
  };
}

// POST real para usar después desde la web
router.post('/api/generate-smart', async (req, res) => {
  try {
    const { game, mode = 'radar_ai' } = req.body || {};

    if (!['primitiva', 'euromillones'].includes(game)) {
      return res.status(400).json({ ok: false, error: 'Juego no válido' });
    }

    const stats = buildStats(game);
    const result = generateSmartNumbers({ game, mode, stats });

    return res.json({ ok: true, result });
  } catch (error) {
    console.error('generate-smart error', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

// GET fácil para probarlo en navegador sin apps externas
router.get('/api/generate-smart-browser', async (req, res) => {
  try {
    const game = req.query.game || 'primitiva';
    const mode = req.query.mode || 'radar_ai';

    if (!['primitiva', 'euromillones'].includes(game)) {
      return res.status(400).json({ ok: false, error: 'Juego no válido' });
    }

    const stats = buildStats(game);
    const result = generateSmartNumbers({ game, mode, stats });

    return res.json({ ok: true, result });
  } catch (error) {
    console.error('generate-smart-browser error', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

export default router;
