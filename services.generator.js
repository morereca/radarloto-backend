import { uniqueWeighted, rand, countConsecutive, maxEndingRepeat, clamp, level, pad2 } from './utils.js';
import { getNumberStats } from './services.stats.js';

export const MODES = [
  { name: 'Equilibrado', desc: 'Reparte mejor pares, impares y zonas del rango.' },
  { name: 'Anti-fechas', desc: 'Evita peso excesivo de números bajos.' },
  { name: 'Números raros', desc: 'Busca combinaciones menos obvias.' },
  { name: 'Alta dispersión', desc: 'Separa más los números entre sí.' },
  { name: 'Números calientes', desc: 'Prioriza los números que más han salido en el histórico guardado.' },
  { name: 'Números fríos', desc: 'Prioriza los números que llevan más tiempo sin salir.' },
  { name: 'Radar Loto IA', desc: 'Combina histórico, equilibrio y dispersión con una heurística mixta.' }
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomReintegro() {
  return Math.floor(Math.random() * 10);
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandomFromTop(ranked, count, topSize, min, max) {
  const pool = [...new Set((ranked || []).map(Number).filter(Number.isFinite))].slice(0, topSize);
  const out = [];
  for (const n of shuffle(pool)) {
    if (!out.includes(n)) out.push(n);
    if (out.length >= count) break;
  }
  while (out.length < count) {
    const n = randomInt(min, max);
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function pickTopHistoricalReintegro(mode) {
  const stats = getNumberStats('primitiva');

  const hotPool = [...(stats?.hotExtra || [])]
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 9)
    .slice(0, 5);

  const coldPool = [...(stats?.coldExtra || [])]
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 9)
    .slice(0, 5);

  if (mode === 'Números calientes' && hotPool.length) {
    return hotPool[randomInt(0, hotPool.length - 1)];
  }

  if (mode === 'Números fríos' && coldPool.length) {
    return coldPool[randomInt(0, coldPool.length - 1)];
  }

  return randomReintegro();
}

function pickIaMain(game, count) {
  const stats = getNumberStats(game);
  const merged = [
    ...(stats.hotMain || []).slice(0, 14),
    ...(stats.coldMain || []).slice(0, 14)
  ];
  return pickRandomFromTop(merged, count, 22, 1, game === 'primitiva' ? 49 : 50);
}

function pickIaExtra(game, count) {
  const stats = getNumberStats(game);
  const merged = [
    ...(stats.hotExtra || []).slice(0, 6),
    ...(stats.coldExtra || []).slice(0, 6)
  ];
  return pickRandomFromTop(merged, count, 8, game === 'primitiva' ? 0 : 1, game === 'primitiva' ? 9 : 12);
}

function buildBuckets(nums) {
  const buckets = {};
  for (const n of nums) {
    const k = Math.floor((n - 1) / 10);
    buckets[k] = (buckets[k] || 0) + 1;
  }
  return buckets;
}

function dispersion(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) total += sorted[i] - sorted[i - 1];
  return total;
}

function calcFrequencyBias(game, nums) {
  const stats = getNumberStats(game);
  const counts = stats?.mainCounts || {};
  const values = Object.values(counts).map(Number).filter(Number.isFinite);
  if (!values.length) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return 0;
  const avgNorm = nums.reduce((acc, n) => {
    const c = Number(counts[n] || 0);
    const norm = (c - min) / (max - min);
    return acc + norm;
  }, 0) / nums.length;
  return Math.round(avgNorm * 24 - 12);
}

function calcStatQuality(game, nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter(n => n % 2 === 1).length;
  const lowLimit = game === 'primitiva' ? 24 : 25;
  const low = sorted.filter(n => n <= lowLimit).length;
  const consecutive = countConsecutive(sorted);
  const repeatEnd = maxEndingRepeat(sorted);
  const spread = dispersion(sorted);
  const buckets = buildBuckets(sorted);
  const maxBucket = Math.max(...Object.values(buckets));

  let score = 86;
  const idealOdd = game === 'primitiva' ? 3 : 2;
  score -= Math.abs(idealOdd - odd) * 7;
  const idealLow = Math.ceil(sorted.length / 2);
  score -= Math.abs(idealLow - low) * 6;
  const minSum = game === 'primitiva' ? 92 : 82;
  const maxSum = game === 'primitiva' ? 190 : 182;
  if (sum < minSum) score -= Math.min(22, Math.round((minSum - sum) / 3));
  if (sum > maxSum) score -= Math.min(22, Math.round((sum - maxSum) / 3));
  score -= consecutive * 12;
  score -= Math.max(0, repeatEnd - 2) * 10;
  if (maxBucket >= 4) score -= 15;
  else if (maxBucket === 3) score -= 6;
  const idealDispMin = game === 'primitiva' ? 26 : 24;
  const idealDispMax = game === 'primitiva' ? 44 : 40;
  if (spread < idealDispMin) score -= Math.min(16, idealDispMin - spread);
  if (spread > idealDispMax) score -= Math.min(12, Math.round((spread - idealDispMax) / 2));
  score += calcFrequencyBias(game, sorted);
  return clamp(score, 8, 98);
}

function calcEstimatedPrizeChance(game, nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const odd = sorted.filter(n => n % 2 === 1).length;
  const lowLimit = game === 'primitiva' ? 24 : 25;
  const low = sorted.filter(n => n <= lowLimit).length;
  const consecutive = countConsecutive(sorted);
  const repeatEnd = maxEndingRepeat(sorted);
  const spread = dispersion(sorted);
  const buckets = buildBuckets(sorted);
  const maxBucket = Math.max(...Object.values(buckets));

  let score = 61;
  const idealOdd = game === 'primitiva' ? 3 : 2;
  score -= Math.abs(idealOdd - odd) * 8;
  const idealLow = Math.ceil(sorted.length / 2);
  score -= Math.abs(idealLow - low) * 7;
  const minSum = game === 'primitiva' ? 92 : 82;
  const maxSum = game === 'primitiva' ? 190 : 182;
  if (sum >= minSum && sum <= maxSum) score += 15;
  else {
    const dist = sum < minSum ? (minSum - sum) : (sum - maxSum);
    score -= Math.min(20, Math.round(dist / 3));
  }
  score -= consecutive * 10;
  score -= Math.max(0, repeatEnd - 2) * 9;
  if (maxBucket >= 4) score -= 16;
  else if (maxBucket === 3) score -= 7;
  const idealDispMin = game === 'primitiva' ? 26 : 24;
  const idealDispMax = game === 'primitiva' ? 44 : 40;
  if (spread >= idealDispMin && spread <= idealDispMax) score += 10;
  else if (spread < idealDispMin) score -= Math.min(15, idealDispMin - spread);
  else score -= Math.min(12, Math.round((spread - idealDispMax) / 2));
  score += calcFrequencyBias(game, sorted);
  return clamp(score, 5, 95);
}

export function generatePrimitiva(mode) {
  let nums = [];
  if (mode === 'Equilibrado') nums = [rand(1, 9), rand(10, 19), rand(20, 29), rand(30, 39), rand(40, 45), rand(46, 49)];
  if (mode === 'Anti-fechas') nums = uniqueWeighted(1, 49, 6, n => (n >= 32 ? 4 : n >= 20 ? 1.5 : 0.5));
  if (mode === 'Números raros') nums = uniqueWeighted(1, 49, 6, n => (n >= 35 ? 4 : n >= 20 ? 1.8 : 0.6));
  if (mode === 'Alta dispersión') nums = [rand(1, 6), rand(8, 14), rand(17, 24), rand(27, 34), rand(37, 43), rand(45, 49)];
  if (mode === 'Números calientes') {
    const stats = getNumberStats('primitiva');
    nums = pickRandomFromTop(stats.hotMain, 6, 18, 1, 49);
  }
  if (mode === 'Números fríos') {
    const stats = getNumberStats('primitiva');
    nums = pickRandomFromTop(stats.coldMain, 6, 18, 1, 49);
  }
  if (mode === 'Radar Loto IA') nums = pickIaMain('primitiva', 6);

  nums = Array.from(new Set(nums));
  while (nums.length < 6) {
    const n = rand(1, 49);
    if (!nums.includes(n)) nums.push(n);
  }
  nums.sort((a, b) => a - b);

  if (mode !== 'Equilibrado' && (countConsecutive(nums) > 0 || maxEndingRepeat(nums) > 2)) {
    return generatePrimitiva(mode);
  }

  let reintegro = randomReintegro();
  if (mode === 'Números calientes') reintegro = pickTopHistoricalReintegro('Números calientes');
  if (mode === 'Números fríos') reintegro = pickTopHistoricalReintegro('Números fríos');
  if (mode === 'Radar Loto IA') reintegro = randomReintegro();

  return { numbers: nums.map(pad2), reintegro };
}

export function generateEuromillones(mode) {
  let nums = [];
  let stars = [];
  if (mode === 'Equilibrado') {
    nums = [rand(1, 10), rand(11, 20), rand(21, 30), rand(31, 40), rand(41, 50)];
    stars = [rand(1, 6), rand(7, 12)];
  }
  if (mode === 'Anti-fechas') {
    nums = uniqueWeighted(1, 50, 5, n => (n >= 32 ? 4 : n >= 20 ? 1.6 : 0.5));
    stars = uniqueWeighted(1, 12, 2, n => (n >= 7 ? 1.4 : 1));
  }
  if (mode === 'Números raros') {
    nums = uniqueWeighted(1, 50, 5, n => (n >= 35 ? 4 : n >= 20 ? 1.8 : 0.6));
    stars = uniqueWeighted(1, 12, 2, n => (n >= 6 ? 1.3 : 1));
  }
  if (mode === 'Alta dispersión') {
    nums = [rand(1, 9), rand(11, 19), rand(21, 29), rand(31, 39), rand(41, 50)];
    stars = [rand(1, 5), rand(8, 12)];
  }
  if (mode === 'Números calientes') {
    const stats = getNumberStats('euromillones');
    nums = pickRandomFromTop(stats.hotMain, 5, 18, 1, 50);
    stars = pickRandomFromTop(stats.hotExtra, 2, 8, 1, 12);
  }
  if (mode === 'Números fríos') {
    const stats = getNumberStats('euromillones');
    nums = pickRandomFromTop(stats.coldMain, 5, 18, 1, 50);
    stars = pickRandomFromTop(stats.coldExtra, 2, 8, 1, 12);
  }
  if (mode === 'Radar Loto IA') {
    nums = pickIaMain('euromillones', 5);
    stars = pickIaExtra('euromillones', 2);
  }

  nums = Array.from(new Set(nums));
  while (nums.length < 5) {
    const n = rand(1, 50);
    if (!nums.includes(n)) nums.push(n);
  }
  stars = Array.from(new Set(stars));
  while (stars.length < 2) {
    const n = rand(1, 12);
    if (!stars.includes(n)) stars.push(n);
  }
  nums.sort((a, b) => a - b);
  stars.sort((a, b) => a - b);

  if (mode !== 'Equilibrado' && (countConsecutive(nums) > 0 || maxEndingRepeat(nums) > 2)) {
    return generateEuromillones(mode);
  }

  return { numbers: nums.map(pad2), stars: stars.map(pad2) };
}

export function analyze(game, draw, mode) {
  const nums = draw.numbers.map(Number);
  const oddCount = nums.filter(n => n % 2 === 1).length;
  let eq = game === 'euromillones' ? 82 - Math.abs(2 - oddCount) * 7 : 80 - Math.abs(3 - oddCount) * 6;
  if (mode === 'Alta dispersión') eq += 8;
  if (mode === 'Equilibrado') eq += 12;
  eq = clamp(eq, 10, 98);

  const statScore = calcStatQuality(game, nums);
  const estimatedPrizeChance = calcEstimatedPrizeChance(game, nums);

  const reasons = [];
  if (mode === 'Equilibrado') reasons.push('Distribuye la combinación por varias zonas del rango.');
  if (mode === 'Anti-fechas') reasons.push('Reduce el peso de números bajos típicos de cumpleaños y fechas.');
  if (mode === 'Números raros') reasons.push('Evita patrones visuales demasiado obvios y secuencias comunes.');
  if (mode === 'Alta dispersión') reasons.push('Busca que los números queden más separados entre sí.');
  if (mode === 'Números calientes') reasons.push('Se apoya en los números más repetidos del histórico guardado.');
  if (mode === 'Números fríos') reasons.push('Se apoya en números que llevan más tiempo sin aparecer.');
  if (mode === 'Radar Loto IA') reasons.push('Combina estadística histórica, dispersión y equilibrio en una sola propuesta.');
  if (countConsecutive(nums) === 0) reasons.push('No aparecen bloques consecutivos claros.');
  if (maxEndingRepeat(nums) <= 2) reasons.push('No repite demasiado la misma terminación.');
  if (statScore >= 85) reasons.push('La combinación tiene una calidad estadística muy alta.');
  else if (statScore >= 70) reasons.push('La combinación tiene una calidad estadística sólida.');
  else reasons.push('La combinación es válida, pero con patrón menos equilibrado.');

  return {
    eq,
    statScore,
    estimatedPrizeChance,
    prizeExplanation: 'Es una estimación visual basada en el histórico y en la estructura de la combinación. No cambia la probabilidad oficial del sorteo ni garantiza premio.',
    statLabel: level(statScore),
    estimatedPrizeLabel: level(estimatedPrizeChance),
    eqLabel: level(eq),
    reasons
  };
}
