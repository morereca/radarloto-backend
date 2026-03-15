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

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rand(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandomFromTop(ranked, count, topSize, min, max) {
  const pool = [...new Set((ranked || []).map(Number).filter(n => Number.isFinite(n)))].slice(0, topSize);
  const out = [];

  for (const n of shuffle(pool)) {
    if (!out.includes(n)) out.push(n);
    if (out.length >= count) break;
  }

  while (out.length < count) {
    const n = rand(min, max);
    if (!out.includes(n)) out.push(n);
  }

  return out.sort((a, b) => a - b);
}

function pickIaMain(game, count) {
  const stats = getNumberStats(game);
  const merged = [
    ...(stats.hotMain || []).slice(0, 12),
    ...(stats.coldMain || []).slice(0, 12)
  ];
  return pickRandomFromTop(merged, count, 18, 1, game === 'primitiva' ? 49 : 50);
}

function pickIaExtra(game, count) {
  const stats = getNumberStats(game);
  const merged = [
    ...(stats.hotExtra || []).slice(0, 6),
    ...(stats.coldExtra || []).slice(0, 6)
  ];
  return pickRandomFromTop(merged, count, 8, game === 'primitiva' ? 0 : 1, game === 'primitiva' ? 9 : 12);
}

function weightedChoice(values, weights, fallbackMin, fallbackMax) {
  const safe = values
    .map((v, i) => ({ value: Number(v), weight: Number(weights[i] || 0) }))
    .filter(x => Number.isFinite(x.value) && Number.isFinite(x.weight) && x.weight > 0);

  if (!safe.length) return rand(fallbackMin, fallbackMax);

  const total = safe.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;

  for (const item of safe) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }

  return safe[safe.length - 1].value;
}

function pickWeightedHistoricalReintegro(mode) {
  const stats = getNumberStats('primitiva');
  const counts = stats?.extraCounts || {};
  const entries = Object.entries(counts)
    .map(([num, count]) => ({ num: Number(num), count: Number(count) }))
    .filter(x => Number.isFinite(x.num) && x.num >= 0 && x.num <= 9 && Number.isFinite(x.count));

  if (!entries.length) return rand(0, 9);

  const hotPool = [...(stats.hotExtra || [])]
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 9)
    .slice(0, 5);

  const coldPool = [...(stats.coldExtra || [])]
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 0 && n <= 9)
    .slice(0, 5);

  let selected = entries;

  if (mode === 'Números calientes' && hotPool.length) {
    selected = entries.filter(x => hotPool.includes(x.num));
  } else if (mode === 'Números fríos' && coldPool.length) {
    selected = entries.filter(x => coldPool.includes(x.num));
  }

  if (!selected.length) selected = entries;

  const values = selected.map(x => x.num);
  const weights = mode === 'Números fríos'
    ? selected.map(x => 1 / Math.max(1, x.count))
    : selected.map(x => x.count);

  return weightedChoice(values, weights, 0, 9);
}

function buildDecadeBuckets(nums) {
  const buckets = {};
  for (const n of nums) {
    const k = Math.floor((n - 1) / 10);
    buckets[k] = (buckets[k] || 0) + 1;
  }
  return buckets;
}

function calcDispersion(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    total += sorted[i] - sorted[i - 1];
  }
  return total;
}

function calcFrequencyScore(game, nums) {
  const stats = getNumberStats(game);
  const counts = stats?.mainCounts || {};
  const vals = Object.values(counts).map(Number).filter(Number.isFinite);

  if (!vals.length) return 0;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (min === max) return 0;

  const avgNorm = nums.reduce((acc, n) => {
    const c = Number(counts[n] || 0);
    const norm = (c - min) / (max - min);
    return acc + norm;
  }, 0) / nums.length;

  return Math.round(avgNorm * 20 - 10); // rango aprox -10 a +10
}

function calcStatQuality(game, nums) {
  const sum = nums.reduce((a, b) => a + b, 0);
  const odd = nums.filter(n => n % 2 === 1).length;
  const lowLimit = game === 'primitiva' ? 24 : 25;
  const low = nums.filter(n => n <= lowLimit).length;
  const consecutive = countConsecutive(nums);
  const repeatEnd = maxEndingRepeat(nums);
  const dispersion = calcDispersion(nums);
  const buckets = buildDecadeBuckets(nums);

  let score = 82;

  const idealOdd = game === 'primitiva' ? 3 : 2;
  score -= Math.abs(idealOdd - odd) * 6;

  const idealLow = Math.ceil(nums.length / 2);
  score -= Math.abs(idealLow - low) * 5;

  const minSum = game === 'primitiva' ? 95 : 85;
  const maxSum = game === 'primitiva' ? 185 : 180;
  if (sum < minSum) score -= Math.min(18, Math.round((minSum - sum) / 4));
  if (sum > maxSum) score -= Math.min(18, Math.round((sum - maxSum) / 4));

  score -= consecutive * 10;
  score -= Math.max(0, repeatEnd - 2) * 8;

  // décadas demasiado cargadas
  const maxBucket = Math.max(...Object.values(buckets));
  if (maxBucket >= 4) score -= 10;
  else if (maxBucket === 3) score -= 4;

  // dispersión
  const idealDispMin = game === 'primitiva' ? 28 : 24;
  const idealDispMax = game === 'primitiva' ? 42 : 38;
  if (dispersion < idealDispMin) score -= Math.min(16, idealDispMin - dispersion);
  if (dispersion > idealDispMax) score -= Math.min(10, Math.round((dispersion - idealDispMax) / 2));

  // frecuencia histórica suave
  score += calcFrequencyScore(game, nums);

  return clamp(score, 15, 98);
}

function calcEstimatedPrizeChance(game, nums) {
  const sum = nums.reduce((a, b) => a + b, 0);
  const odd = nums.filter(n => n % 2 === 1).length;
  const lowLimit = game === 'primitiva' ? 24 : 25;
  const low = nums.filter(n => n <= lowLimit).length;
  const consecutive = countConsecutive(nums);
  const repeatEnd = maxEndingRepeat(nums);
  const dispersion = calcDispersion(nums);
  const buckets = buildDecadeBuckets(nums);

  let score = 58;

  const idealOdd = game === 'primitiva' ? 3 : 2;
  score -= Math.abs(idealOdd - odd) * 6;

  const idealLow = Math.ceil(nums.length / 2);
  score -= Math.abs(idealLow - low) * 5;

  const minSum = game === 'primitiva' ? 95 : 85;
  const maxSum = game === 'primitiva' ? 185 : 180;
  if (sum >= minSum && sum <= maxSum) score += 18;
  else {
    const dist = sum < minSum ? (minSum - sum) : (sum - maxSum);
    score -= Math.min(18, Math.round(dist / 3));
  }

  score -= consecutive * 9;
  score -= Math.max(0, repeatEnd - 2) * 7;

  const maxBucket = Math.max(...Object.values(buckets));
  if (maxBucket >= 4) score -= 12;
  else if (maxBucket === 3) score -= 5;

  const idealDispMin = game === 'primitiva' ? 28 : 24;
  const idealDispMax = game === 'primitiva' ? 42 : 38;
  if (dispersion >= idealDispMin && dispersion <= idealDispMax) score += 10;
  else if (dispersion < idealDispMin) score -= Math.min(12, idealDispMin - dispersion);
  else score -= Math.min(8, Math.round((dispersion - idealDispMax) / 2));

  score += calcFrequencyScore(game, nums);

  return clamp(score, 8, 92);
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

  let reintegro = rand(0, 9);
  if (mode === 'Números calientes' || mode === 'Números fríos') {
    reintegro = pickWeightedHistoricalReintegro(mode);
  }
  if (mode === 'Radar Loto IA') {
    reintegro = rand(0, 9);
  }

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
  const consecutive = countConsecutive(nums);
  const repeatEnd = maxEndingRepeat(nums);

  let eq = game === 'euromillones' ? 82 - Math.abs(2 - oddCount) * 7 : 80 - Math.abs(3 - oddCount) * 6;
  if (mode === 'Alta dispersión') eq += 8;
  if (mode === 'Equilibrado') eq += 12;
  eq = clamp(eq, 20, 96);

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
  if (consecutive === 0) reasons.push('No aparecen bloques consecutivos claros.');
  if (repeatEnd <= 2) reasons.push('No repite demasiado la misma terminación.');
  if (statScore >= 85) reasons.push('La combinación tiene una calidad estadística muy alta.');
  else if (statScore >= 70) reasons.push('La combinación tiene una calidad estadística sólida.');
  else reasons.push('La combinación es válida, pero con patrón menos equilibrado.');

  const prizeExplanation = 'Es una estimación visual basada en el histórico y en la estructura de la combinación. No cambia la probabilidad oficial del sorteo ni garantiza premio.';

  return {
    eq,
    statScore,
    statLabel: level(statScore),
    estimatedPrizeChance,
    estimatedPrizeLabel: level(estimatedPrizeChance),
    prizeExplanation,
    eqLabel: level(eq),
    reasons
  };
}
