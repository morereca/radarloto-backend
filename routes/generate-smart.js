
const express = require('express');
const router = express.Router();
const { generateNumbers } = require('../generator.engine');
const { loadStatsForGame } = require('../stats.provider');

router.post('/api/generate-smart', async (req, res) => {
  try {
    const { game, mode } = req.body || {};

    if (!['primitiva', 'euromillones'].includes(game)) {
      return res.status(400).json({ ok: false, error: 'Invalid game' });
    }

    if (!['random', 'hot', 'cold', 'balanced', 'anti_dates', 'high_dispersion', 'radar_ai'].includes(mode)) {
      return res.status(400).json({ ok: false, error: 'Invalid mode' });
    }

    const stats = await loadStatsForGame(game);
    const result = generateNumbers({ game, mode, stats });

    return res.json({ ok: true, result });
  } catch (error) {
    console.error('generate-smart error', error);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

module.exports = router;
