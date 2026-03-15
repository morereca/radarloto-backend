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



function safeReintegroFromStats(source, fallback) {
  const n = Number(source);
  return Number.isFinite(n) ? n : fallback;
}

function pickFromRanked(ranked, count, fallbackMin, fallbackMax) {
  const out = [];
  const pool = ranked.map(Number).filter((n) => !Number.isNaN(n));
  let cursor = 0;
  while (out.length < count && cursor < pool.length) {
    const candidate = pool[cursor++];
    if (!out.includes(candidate)) out.push(candidate);
  }
  while (out.length < count) {
    const n = rand(fallbackMin, fallbackMax);
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

function pickIaMain(game, count) {
  const stats = getNumberStats(game);
  const hot = stats.hotMain.slice(0, Math.max(count + 3, 10));
  const cold = stats.coldMain.slice(0, Math.max(count + 3, 10));
  const merged = [];
  for (let i = 0; i < Math.max(hot.length, cold.length); i++) {
    if (hot[i] != null) merged.push(Number(hot[i]));
    if (cold[i] != null) merged.push(Number(cold[i]));
  }
  return pickFromRanked(merged, count, 1, game === 'primitiva' ? 49 : 50);
}

function pickIaExtra(game, count) {
  const stats = getNumberStats(game);
  const hot = stats.hotExtra.slice(0, Math.max(count + 2, 6));
  const cold = stats.coldExtra.slice(0, Math.max(count + 2, 6));
  const merged = [];
  for (let i = 0; i < Math.max(hot.length, cold.length); i++) {
    if (hot[i] != null) merged.push(Number(hot[i]));
    if (cold[i] != null) merged.push(Number(cold[i]));
  }
  return pickFromRanked(merged, count, game === 'primitiva' ? 0 : 1, game === 'primitiva' ? 9 : 12);
}

export function generatePrimitiva(mode) {
  let nums = [];
  if (mode === 'Equilibrado') nums = [rand(1, 9), rand(10, 19), rand(20, 29), rand(30, 39), rand(40, 45), rand(46, 49)];
  if (mode === 'Anti-fechas') nums = uniqueWeighted(1, 49, 6, (n) => (n >= 32 ? 4 : n >= 20 ? 1.5 : 0.5));
  if (mode === 'Números raros') nums = uniqueWeighted(1, 49, 6, (n) => (n >= 35 ? 4 : n >= 20 ? 1.8 : 0.6));
  if (mode === 'Alta dispersión') nums = [rand(1, 6), rand(8, 14), rand(17, 24), rand(27, 34), rand(37, 43), rand(45, 49)];
  if (mode === 'Números calientes') {
    const stats = getNumberStats('primitiva');
    nums = pickFromRanked(stats.hotMain.slice(0, 18), 6, 1, 49);
  }
  if (mode === 'Números fríos') {
    const stats = getNumberStats('primitiva');
    nums = pickFromRanked(stats.coldMain.slice(0, 18), 6, 1, 49);
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
  if (mode === 'Números calientes') {
    const stats = getNumberStats('primitiva');
    reintegro = safeReintegroFromStats(stats?.hotExtra?.[0], reintegro);
  }
  if (mode === 'Números fríos') {
    const stats = getNumberStats('primitiva');
    reintegro = safeReintegroFromStats(stats?.coldExtra?.[0], reintegro);
  }
  if (mode === 'Radar Loto IA') {
    const stats = getNumberStats('primitiva');
    reintegro = safeReintegroFromStats(stats?.hotExtra?.[0] ?? stats?.coldExtra?.[0], reintegro);
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
    nums = uniqueWeighted(1, 50, 5, (n) => (n >= 32 ? 4 : n >= 20 ? 1.6 : 0.5));
    stars = uniqueWeighted(1, 12, 2, (n) => (n >= 7 ? 1.4 : 1));
  }
  if (mode === 'Números raros') {
    nums = uniqueWeighted(1, 50, 5, (n) => (n >= 35 ? 4 : n >= 20 ? 1.8 : 0.6));
    stars = uniqueWeighted(1, 12, 2, (n) => (n >= 6 ? 1.3 : 1));
  }
  if (mode === 'Alta dispersión') {
    nums = [rand(1, 9), rand(11, 19), rand(21, 29), rand(31, 39), rand(41, 50)];
    stars = [rand(1, 5), rand(8, 12)];
  }
  if (mode === 'Números calientes') {
    const stats = getNumberStats('euromillones');
    nums = pickFromRanked(stats.hotMain.slice(0, 18), 5, 1, 50);
    stars = pickFromRanked(stats.hotExtra.slice(0, 8), 2, 1, 12);
  }
  if (mode === 'Números fríos') {
    const stats = getNumberStats('euromillones');
    nums = pickFromRanked(stats.coldMain.slice(0, 18), 5, 1, 50);
    stars = pickFromRanked(stats.coldExtra.slice(0, 8), 2, 1, 12);
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
  const lowCount = nums.filter((n) => n <= 31).length;
  const highCount = nums.filter((n) => n >= 32).length;
  const oddCount = nums.filter((n) => n % 2 === 1).length;
  const consecutive = countConsecutive(nums);
  const repeatEnd = maxEndingRepeat(nums);

  let rare = 56 + highCount * 7 - consecutive * 12 - (repeatEnd - 1) * 8;
  let pop = 48 + lowCount * 8 + consecutive * 10 + (repeatEnd - 1) * 6;
  let eq = game === 'euromillones' ? 82 - Math.abs(2 - oddCount) * 7 : 80 - Math.abs(3 - oddCount) * 6;

  if (mode === 'Números raros') rare += 14;
  if (mode === 'Anti-fechas') pop -= 18;
  if (mode === 'Alta dispersión') {
    rare += 4;
    eq += 8;
  }
  if (mode === 'Equilibrado') eq += 12;

  rare = clamp(rare, 8, 98);
  pop = clamp(pop, 8, 95);
  eq = clamp(eq, 20, 96);

  const reasons = [];
  if (mode === 'Equilibrado') reasons.push('Distribuye la combinación por varias zonas del rango.');
  if (mode === 'Anti-fechas') reasons.push('Reduce el peso de números bajos típicos de cumpleaños y fechas.');
  if (mode === 'Números raros') reasons.push('Evita patrones visuales demasiado obvios y secuencias comunes.');
  if (mode === 'Alta dispersión') reasons.push('Busca que los números queden más separados entre sí.');
  if (mode === 'Números calientes') reasons.push('Se apoya en los números más repetidos del histórico guardado.');
  if (mode === 'Números fríos') reasons.push('Se apoya en números que llevan más tiempo sin aparecer.');
  if (mode === 'Radar Loto IA') reasons.push('Combina estadística histórica, dispersión y equilibrio en una sola propuesta.');
  reasons.push(consecutive === 0 ? 'No aparecen bloques consecutivos claros.' : 'Tiene poca continuidad visual.');
  reasons.push(repeatEnd <= 2 ? 'No repite demasiado la misma terminación.' : 'Mantiene variedad en las terminaciones.');

  return {
    rare, pop, eq,
    rareLabel: level(rare),
    popLabel: level(pop),
    eqLabel: level(eq),
    reasons
  };
}