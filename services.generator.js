
import { uniqueWeighted, rand, countConsecutive, maxEndingRepeat, clamp, level, pad2 } from './utils.js';
import { getNumberStats } from './services.stats.js';

export const MODES = [
  { name: 'Equilibrado', desc: 'Reparte mejor pares, impares y zonas del rango.' },
  { name: 'Anti-fechas', desc: 'Evita peso excesivo de números bajos.' },
  { name: 'Números raros', desc: 'Busca combinaciones menos obvias.' },
  { name: 'Alta dispersión', desc: 'Separa más los números entre sí.' },
  { name: 'Números calientes', desc: 'Prioriza los números que más han salido en el histórico.' },
  { name: 'Números fríos', desc: 'Prioriza los números que menos han salido.' },
  { name: 'Radar Loto IA', desc: 'Combina histórico, equilibrio y dispersión.' }
];

function pickRandom(arr) {
  return arr[rand(0, arr.length - 1)];
}

function pickRandomFromTop(list, count, max) {
  const pool = [...new Set((list || []).map(Number))].slice(0, max);
  const result = [];

  while (result.length < count) {
    const n = pickRandom(pool.length ? pool : Array.from({length:max},(_,i)=>i+1));
    if (!result.includes(n)) result.push(n);
  }

  return result.sort((a,b)=>a-b);
}

function pickSmartPrimitivaReintegro(mode) {
  const stats = getNumberStats('primitiva');

  if (!stats || !stats.extraCounts) {
    return rand(0,9);
  }

  const entries = Object.entries(stats.extraCounts);
  const weighted = [];

  for (const [num,count] of entries) {
    let weight = count;

    if (mode === 'Números fríos') {
      weight = Math.max(1, Math.round(100 / (count+1)));
    }

    if (mode === 'Radar Loto IA') {
      weight = Math.round(Math.sqrt(count) * 3);
    }

    for (let i=0;i<weight;i++){
      weighted.push(Number(num));
    }
  }

  if (!weighted.length) return rand(0,9);

  return weighted[rand(0, weighted.length-1)];
}

export function generatePrimitiva(mode) {

  let nums = [];

  if (mode === 'Equilibrado') nums = [rand(1,9),rand(10,19),rand(20,29),rand(30,39),rand(40,45),rand(46,49)];
  if (mode === 'Anti-fechas') nums = uniqueWeighted(1,49,6,n=>n>=32?4:n>=20?1.5:0.5);
  if (mode === 'Números raros') nums = uniqueWeighted(1,49,6,n=>n>=35?4:n>=20?1.8:0.6);
  if (mode === 'Alta dispersión') nums=[rand(1,6),rand(8,14),rand(17,24),rand(27,34),rand(37,43),rand(45,49)];

  if (mode === 'Números calientes') {
    const stats=getNumberStats('primitiva');
    nums = pickRandomFromTop(stats.hotMain,6,20);
  }

  if (mode === 'Números fríos') {
    const stats=getNumberStats('primitiva');
    nums = pickRandomFromTop(stats.coldMain,6,20);
  }

  if (mode === 'Radar Loto IA') {
    const stats=getNumberStats('primitiva');
    nums = pickRandomFromTop([...stats.hotMain,...stats.coldMain],6,30);
  }

  nums = Array.from(new Set(nums));
  while(nums.length<6){
    const n=rand(1,49);
    if(!nums.includes(n)) nums.push(n);
  }

  nums.sort((a,b)=>a-b);

  if(mode!=='Equilibrado' && (countConsecutive(nums)>0 || maxEndingRepeat(nums)>2)){
    return generatePrimitiva(mode);
  }

  const reintegro = pickSmartPrimitivaReintegro(mode);

  return { numbers: nums.map(pad2), reintegro };
}

export function generateEuromillones(mode){

  let nums=[];
  let stars=[];

  if(mode==='Equilibrado'){
    nums=[rand(1,10),rand(11,20),rand(21,30),rand(31,40),rand(41,50)];
    stars=[rand(1,6),rand(7,12)];
  }

  if(mode==='Números calientes'){
    const stats=getNumberStats('euromillones');
    nums=pickRandomFromTop(stats.hotMain,5,20);
    stars=pickRandomFromTop(stats.hotExtra,2,8);
  }

  if(mode==='Números fríos'){
    const stats=getNumberStats('euromillones');
    nums=pickRandomFromTop(stats.coldMain,5,20);
    stars=pickRandomFromTop(stats.coldExtra,2,8);
  }

  if(mode==='Radar Loto IA'){
    const stats=getNumberStats('euromillones');
    nums=pickRandomFromTop([...stats.hotMain,...stats.coldMain],5,30);
    stars=pickRandomFromTop([...stats.hotExtra,...stats.coldExtra],2,8);
  }

  nums=Array.from(new Set(nums));
  while(nums.length<5){
    const n=rand(1,50);
    if(!nums.includes(n)) nums.push(n);
  }

  stars=Array.from(new Set(stars));
  while(stars.length<2){
    const n=rand(1,12);
    if(!stars.includes(n)) stars.push(n);
  }

  nums.sort((a,b)=>a-b);
  stars.sort((a,b)=>a-b);

  return { numbers: nums.map(pad2), stars: stars.map(pad2) };
}

export function analyze(game, draw, mode){

  const nums = draw.numbers.map(Number);

  const low = nums.filter(n=>n<=31).length;
  const high = nums.filter(n=>n>=32).length;
  const odd = nums.filter(n=>n%2===1).length;

  const consecutive = countConsecutive(nums);
  const repeatEnd = maxEndingRepeat(nums);

  let rare = 56 + high*7 - consecutive*12 - (repeatEnd-1)*8;
  let pop = 48 + low*8 + consecutive*10 + (repeatEnd-1)*6;
  let eq = game==='euromillones' ? 82-Math.abs(2-odd)*7 : 80-Math.abs(3-odd)*6;

  rare=clamp(rare,8,98);
  pop=clamp(pop,8,95);
  eq=clamp(eq,20,96);

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
