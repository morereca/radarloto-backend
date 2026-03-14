
import express from 'express';
import { getNumberStats } from '../services.stats.js';
import { generateSmartNumbers } from '../smart.generator.js';

const router = express.Router();

router.post('/api/generate-smart', async (req, res) => {
  try {
    const { game, mode = 'radar_ai' } = req.body || {};

    if (!['primitiva', 'euromillones'].includes(game)) {
      return res.status(400).json({ ok: false, error: 'Juego no válido' });
    }

    const internalStats = getNumberStats(game);
    const stats = {
      hotMain: internalStats.hotMain || [],
      coldMain: internalStats.coldMain || [],
      hotExtra: internalStats.hotExtra || [],
      coldExtra: internalStats.coldExtra || [],
    };

    const result = generateSmartNumbers({ game, mode, stats });
    return res.json({ ok: true, result });
  } catch (error) {
    console.error('generate-smart error', error);
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

export default router;
