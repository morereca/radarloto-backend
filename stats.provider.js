
const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(__dirname, 'sample.stats.json');

async function loadStatsForGame(game) {
  const raw = fs.readFileSync(STATS_PATH, 'utf-8');
  const json = JSON.parse(raw);
  return json[game] || {
    hotMain: [],
    coldMain: [],
    hotExtra: [],
    coldExtra: [],
  };
}

module.exports = { loadStatsForGame };
