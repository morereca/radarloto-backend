
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sampleUnique(pool, count) {
  const copy = [...new Set(pool)];
  const out = [];
  while (out.length < count && copy.length) {
    const idx = randInt(0, copy.length - 1);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function uniqueSorted(nums) {
  return [...new Set(nums)].sort((a, b) => a - b);
}

function rangeArray(min, max) {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

function countEven(nums) {
  return nums.filter(n => n % 2 === 0).length;
}

function countLow(nums, split) {
  return nums.filter(n => n <= split).length;
}

function consecutivePenalty(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  let penalty = 0;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run += 1;
      if (run >= 3) penalty += 3;
    } else {
      run = 1;
    }
  }
  return penalty;
}

function decadePenalty(nums) {
  const buckets = new Map();
  for (const n of nums) {
    const bucket = Math.floor((n - 1) / 10);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }
  let penalty = 0;
  for (const count of buckets.values()) {
    if (count >= 4) penalty += 3;
  }
  return penalty;
}

function dispersionScore(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  let totalGap = 0;
  for (let i = 1; i < sorted.length; i += 1) totalGap += sorted[i] - sorted[i - 1];
  return totalGap;
}

function weightedPick(pool, weights, count) {
  const chosen = new Set();
  const out = [];
  const safePool = [...new Set(pool)];
  while (out.length < count && chosen.size < safePool.length) {
    const available = safePool.filter(n => !chosen.has(n));
    const totalWeight = available.reduce((acc, n) => acc + (weights.get(n) || 1), 0);
    let r = Math.random() * totalWeight;
    let picked = available[0];
    for (const n of available) {
      r -= (weights.get(n) || 1);
      if (r <= 0) {
        picked = n;
        break;
      }
    }
    chosen.add(picked);
    out.push(picked);
  }
  return out;
}

function getGameConfig(game) {
  if (game === 'primitiva') {
    return {
      mainMin: 1,
      mainMax: 49,
      mainCount: 6,
      split: 24,
      extraType: 'reintegro',
      extraMin: 0,
      extraMax: 9,
      extraCount: 1,
    };
  }

  if (game === 'euromillones') {
    return {
      mainMin: 1,
      mainMax: 50,
      mainCount: 5,
      split: 25,
      extraType: 'stars',
      extraMin: 1,
      extraMax: 12,
      extraCount: 2,
    };
  }

  throw new Error(`Unsupported game: ${game}`);
}

function buildExtras(game, stats, mode) {
  const cfg = getGameConfig(game);

  if (cfg.extraType === 'reintegro') {
    if (mode === 'hot' && Array.isArray(stats?.hotExtra) && stats.hotExtra.length) {
      return { reintegro: stats.hotExtra[randInt(0, stats.hotExtra.length - 1)] };
    }
    if (mode === 'cold' && Array.isArray(stats?.coldExtra) && stats.coldExtra.length) {
      return { reintegro: stats.coldExtra[randInt(0, stats.coldExtra.length - 1)] };
    }
    return { reintegro: randInt(cfg.extraMin, cfg.extraMax) };
  }

  let starsPool = rangeArray(cfg.extraMin, cfg.extraMax);
  if (mode === 'hot' && Array.isArray(stats?.hotExtra) && stats.hotExtra.length) {
    const hot = stats.hotExtra.filter(n => n >= cfg.extraMin && n <= cfg.extraMax);
    if (hot.length >= cfg.extraCount) starsPool = [...new Set([...hot, ...starsPool])];
  }
  if (mode === 'cold' && Array.isArray(stats?.coldExtra) && stats.coldExtra.length) {
    const cold = stats.coldExtra.filter(n => n >= cfg.extraMin && n <= cfg.extraMax);
    if (cold.length >= cfg.extraCount) starsPool = [...new Set([...cold, ...starsPool])];
  }

  return { stars: uniqueSorted(sampleUnique(starsPool, cfg.extraCount)) };
}

function generateRandom(game, stats) {
  const cfg = getGameConfig(game);
  const numbers = uniqueSorted(sampleUnique(rangeArray(cfg.mainMin, cfg.mainMax), cfg.mainCount));
  return { game, numbers, ...buildExtras(game, stats, 'random') };
}

function generateHot(game, stats) {
  const cfg = getGameConfig(game);
  const hot = Array.isArray(stats?.hotMain) ? stats.hotMain.filter(n => n >= cfg.mainMin && n <= cfg.mainMax) : [];
  const fallback = rangeArray(cfg.mainMin, cfg.mainMax);

  const weights = new Map();
  for (const n of fallback) weights.set(n, 1);
  hot.forEach((n, i) => weights.set(n, Math.max(10 - i, 3)));

  let numbers = uniqueSorted(weightedPick(fallback, weights, cfg.mainCount));
  if (numbers.length < cfg.mainCount) {
    numbers = uniqueSorted([...numbers, ...sampleUnique(fallback.filter(n => !numbers.includes(n)), cfg.mainCount - numbers.length)]);
  }

  return { game, numbers, ...buildExtras(game, stats, 'hot') };
}

function generateCold(game, stats) {
  const cfg = getGameConfig(game);
  const cold = Array.isArray(stats?.coldMain) ? stats.coldMain.filter(n => n >= cfg.mainMin && n <= cfg.mainMax) : [];
  const fallback = rangeArray(cfg.mainMin, cfg.mainMax);

  const weights = new Map();
  for (const n of fallback) weights.set(n, 1);
  cold.forEach((n, i) => weights.set(n, Math.max(10 - i, 3)));

  let numbers = uniqueSorted(weightedPick(fallback, weights, cfg.mainCount));
  if (numbers.length < cfg.mainCount) {
    numbers = uniqueSorted([...numbers, ...sampleUnique(fallback.filter(n => !numbers.includes(n)), cfg.mainCount - numbers.length)]);
  }

  return { game, numbers, ...buildExtras(game, stats, 'cold') };
}

function generateBalanced(game, stats) {
  const cfg = getGameConfig(game);
  const all = rangeArray(cfg.mainMin, cfg.mainMax);

  const targetEven = game === 'primitiva' ? 3 : 2;
  const targetLow = Math.ceil(cfg.mainCount / 2);

  const evens = all.filter(n => n % 2 === 0);
  const odds = all.filter(n => n % 2 !== 0);
  const lows = all.filter(n => n <= cfg.split);
  const highs = all.filter(n => n > cfg.split);

  let out = [
    ...sampleUnique(evens, targetEven),
    ...sampleUnique(odds, cfg.mainCount - targetEven),
  ];

  out = uniqueSorted(out);

  let lowCount = countLow(out, cfg.split);
  while (lowCount < targetLow) {
    const candidate = sampleUnique(lows.filter(n => !out.includes(n)), 1)[0];
    const replaceIndex = out.findIndex(n => n > cfg.split);
    if (candidate == null || replaceIndex === -1) break;
    out[replaceIndex] = candidate;
    out = uniqueSorted(out);
    lowCount = countLow(out, cfg.split);
  }

  while (lowCount > targetLow) {
    const candidate = sampleUnique(highs.filter(n => !out.includes(n)), 1)[0];
    const replaceIndex = out.findIndex(n => n <= cfg.split);
    if (candidate == null || replaceIndex === -1) break;
    out[replaceIndex] = candidate;
    out = uniqueSorted(out);
    lowCount = countLow(out, cfg.split);
  }

  return { game, numbers: out, ...buildExtras(game, stats, 'balanced') };
}

function generateAntiDates(game, stats) {
  const cfg = getGameConfig(game);
  const all = rangeArray(cfg.mainMin, cfg.mainMax);
  const highBias = all.filter(n => n > 31);

  let out = [];
  out.push(...sampleUnique(highBias, Math.min(cfg.mainCount - 2, highBias.length)));
  out.push(...sampleUnique(all.filter(n => !out.includes(n)), cfg.mainCount - out.length));
  out = uniqueSorted(out);

  return { game, numbers: out, ...buildExtras(game, stats, 'anti_dates') };
}

function generateHighDispersion(game, stats) {
  const cfg = getGameConfig(game);
  const buckets = game === 'primitiva'
    ? [[1, 9], [10, 19], [20, 29], [30, 39], [40, 49], [1, 49]]
    : [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50]];

  const out = [];
  for (let i = 0; i < cfg.mainCount; i += 1) {
    const [min, max] = buckets[i];
    const bucket = rangeArray(min, max).filter(n => !out.includes(n));
    out.push(sampleUnique(bucket, 1)[0]);
  }

  return { game, numbers: uniqueSorted(out), ...buildExtras(game, stats, 'high_dispersion') };
}

function scoreCombination(game, numbers, stats) {
  const cfg = getGameConfig(game);
  const hot = new Set(Array.isArray(stats?.hotMain) ? stats.hotMain : []);
  const cold = new Set(Array.isArray(stats?.coldMain) ? stats.coldMain : []);

  let score = 0;
  const evenCount = countEven(numbers);
  const lowCount = countLow(numbers, cfg.split);
  const idealEven = game === 'primitiva' ? 3 : 2;
  const idealLow = Math.ceil(cfg.mainCount / 2);

  score -= Math.abs(evenCount - idealEven) * 2;
  score -= Math.abs(lowCount - idealLow) * 2;

  const hotCount = numbers.filter(n => hot.has(n)).length;
  const coldCount = numbers.filter(n => cold.has(n)).length;
  if (hotCount >= 2) score += 3;
  if (coldCount >= 1) score += 2;
  if (hotCount > 4) score -= 3;
  if (coldCount > 3) score -= 2;

  score += Math.min(Math.floor(dispersionScore(numbers) / 8), 8);
  score -= consecutivePenalty(numbers);
  score -= decadePenalty(numbers);

  if (numbers.filter(n => n <= 31).length >= cfg.mainCount - 1) score -= 2;
  return score;
}

function generateRadarAI(game, stats) {
  const cfg = getGameConfig(game);
  const generators = [
    () => generateBalanced(game, stats).numbers,
    () => generateHighDispersion(game, stats).numbers,
    () => generateHot(game, stats).numbers,
    () => generateCold(game, stats).numbers,
    () => generateRandom(game, stats).numbers,
    () => generateAntiDates(game, stats).numbers,
  ];

  let best = null;
  let bestScore = -Infinity;

  for (let i = 0; i < 250; i += 1) {
    const source = generators[randInt(0, generators.length - 1)];
    const candidate = uniqueSorted(source()).slice(0, cfg.mainCount);
    if (candidate.length !== cfg.mainCount) continue;
    const score = scoreCombination(game, candidate, stats);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return { game, numbers: best || generateBalanced(game, stats).numbers, ...buildExtras(game, stats, 'radar_ai'), score: bestScore };
}

function generateNumbers({ game, mode = 'random', stats = {} }) {
  switch (mode) {
    case 'random': return generateRandom(game, stats);
    case 'hot': return generateHot(game, stats);
    case 'cold': return generateCold(game, stats);
    case 'balanced': return generateBalanced(game, stats);
    case 'anti_dates': return generateAntiDates(game, stats);
    case 'high_dispersion': return generateHighDispersion(game, stats);
    case 'radar_ai': return generateRadarAI(game, stats);
    default: throw new Error(`Unsupported mode: ${mode}`);
  }
}

module.exports = {
  generateNumbers,
  scoreCombination,
  getGameConfig,
};
