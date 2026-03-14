import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATS_PATH = path.join(__dirname, 'sample.stats.json');

export async function loadStatsForGame(game) {
  const raw = fs.readFileSync(STATS_PATH, 'utf-8');
  const json = JSON.parse(raw);
  return json[game] || {
    hotMain: [],
    coldMain: [],
    hotExtra: [],
    coldExtra: [],
  };
}
