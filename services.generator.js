
import { uniqueWeighted, rand, countConsecutive, maxEndingRepeat, clamp, level, pad2 } from './utils.js';
import { getNumberStats } from './services.stats.js';

function pickSmartPrimitivaReintegro(mode) {
  const stats = getNumberStats('primitiva');
  const fallback = rand(0, 9);

  if (mode === 'Números calientes') {
    const pool = (stats.hotExtra || [])
      .slice(0, 5)
      .map(Number)
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 9);

    if (pool.length) {
      return pool[rand(0, pool.length - 1)];
    }

    return fallback;
  }

  if (mode === 'Números fríos') {
    const pool = (stats.coldExtra || [])
      .slice(0, 5)
      .map(Number)
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 9);

    if (pool.length) {
      return pool[rand(0, pool.length - 1)];
    }

    return fallback;
  }

  if (mode === 'Radar Loto IA') {
    const pool = [
      ...(stats.hotExtra || []).slice(0, 3),
      ...(stats.coldExtra || []).slice(0, 3)
    ]
      .map(Number)
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 9);

    const uniquePool = [...new Set(pool)];

    if (uniquePool.length) {
      return uniquePool[rand(0, uniquePool.length - 1)];
    }

    return fallback;
  }

  return fallback;
}

export { pickSmartPrimitivaReintegro };
