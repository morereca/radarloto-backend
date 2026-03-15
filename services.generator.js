
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
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandomFromTop(ranked, count, topSize, min, max) {
  const pool = [...new Set((ranked || []).map(Number))].slice(0, topSize);
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

function pickSmartPrimitivaReintegro(mode) {
  const stats = getNumberStats('primitiva');

  if (!stats || !stats.extraCounts) {
    return rand(0, 9);
  }

  const counts = stats.extraCounts;
  const pool = [];

  for (const [num, count] of Object.entries(counts)) {

    let weight = count;

    if (mode === 'Números fríos') {
      weight = 1 / (count + 1);
    }

    if (mode === 'Radar Loto IA') {
      weight = Math.sqrt(count);
    }

    for (let i = 0; i < Math.round(weight); i++) {
      pool.push(Number(num));
    }
  }

  if (pool.length === 0) {
    return rand(0, 9);
  }

  return pool[rand(0, pool.length - 1)];
}

export function generatePrimitiva(mode) {
  let nums = [];

  if (mode === 'Equilibrado') nums = [rand(1,9), rand(10,19), rand(20,29), rand(30,39), rand(40,45), rand(46,49)];
  if (mode === 'Anti-fechas') nums = uniqueWeighted(1,49,6,n => n>=32?4:n>=20?1.5:0.5);
  if (mode === 'Números raros') nums = uniqueWeighted(1,49,6,n => n>=35?4:n>=20?1.8:0.6);
  if (mode === 'Alta dispersión') nums = [rand(1,6),rand(8,14),rand(17,24),rand(27,34),rand(37,43),rand(45,49)];

  if (mode === 'Números calientes') {
    const stats = getNumberStats('primitiva');
    nums = pickRandomFromTop(stats.hotMain,6,18,1,49);
  }

  if (mode === 'Números fríos') {
    const stats = getNumberStats('primitiva');
    nums = pickRandomFromTop(stats.coldMain,6,18,1,49);
  }

  if (mode === 'Radar Loto IA') {
    const stats = getNumberStats('primitiva');
    nums = pickRandomFromTop([...stats.hotMain,...stats.coldMain],6,24,1,49);
  }

  nums = Array.from(new Set(nums));
  while (nums.length < 6) {
    const n = rand(1,49);
    if (!nums.includes(n)) nums.push(n);
  }

  nums.sort((a,b)=>a-b);

  if (mode !== 'Equilibrado' && (countConsecutive(nums)>0 || maxEndingRepeat(nums)>2)) {
    return generatePrimitiva(mode);
  }

  const reintegro = pickSmartPrimitivaReintegro(mode);

  return { numbers: nums.map(pad2), reintegro };
}

export function generateEuromillones(mode) {
  let nums = [];
  let stars = [];

  if (mode === 'Equilibrado') {
    nums = [rand(1,10),rand(11,20),rand(21,30),rand(31,40),rand(41,50)];
    stars = [rand(1,6),rand(7,12)];
  }

  if (mode === 'Números calientes') {
    const stats = getNumberStats('euromillones');
    nums = pickRandomFromTop(stats.hotMain,5,18,1,50);
    stars = pickRandomFromTop(stats.hotExtra,2,8,1,12);
  }

  if (mode === 'Números fríos') {
    const stats = getNumberStats('euromillones');
    nums = pickRandomFromTop(stats.coldMain,5,18,1,50);
    stars = pickRandomFromTop(stats.coldExtra,2,8,1,12);
  }

  if (mode === 'Radar Loto IA') {
    const stats = getNumberStats('euromillones');
    nums = pickRandomFromTop([...stats.hotMain,...stats.coldMain],5,24,1,50);
    stars = pickRandomFromTop([...stats.hotExtra,...stats.coldExtra],2,8,1,12);
  }

  nums = Array.from(new Set(nums));
  while (nums.length < 5) {
    const n = rand(1,50);
    if (!nums.includes(n)) nums.push(n);
  }

  stars = Array.from(new Set(stars));
  while (stars.length < 2) {
    const n = rand(1,12);
    if (!stars.includes(n)) stars.push(n);
  }

  nums.sort((a,b)=>a-b);
  stars.sort((a,b)=>a-b);

  return { numbers: nums.map(pad2), stars: stars.map(pad2) };
}

export function analyze(game, draw, mode) {
  const nums = draw.numbers.map(Number);

  const low = nums.filter(n=>n<=31).length;
  const high = nums.filter(n=>n>=32).length;
  const odd = nums.filter(n=>n%2===1).length;

  const consecutive = countConsecutive(nums);
  const repeatEnd = maxEndingRepeat(nums);

  let rare = 56 + high*7 - consecutive*12 - (repeatEnd-1)*8;
  let pop = 48 + low*8 + consecutive*10 + (repeatEnd-1)*6;
  let eq = game==='euromillones' ? 82-Math.abs(2-odd)*7 : 80-Math.abs(3-odd)*6;

  rare = clamp(rare,8,98);
  pop = clamp(pop,8,95);
  eq = clamp(eq,20,96);

  return {
    rare,
    pop,
    eq,
    rareLabel: level(rare),
    popLabel: level(pop),
    eqLabel: level(eq),
    reasons: []
  };
}
