
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

function randomReintegro(){
  return Math.floor(Math.random()*10);
}

function shuffle(arr){
  const copy=[...arr];
  for(let i=copy.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [copy[i],copy[j]]=[copy[j],copy[i]];
  }
  return copy;
}

function pickRandomFromTop(ranked,count,topSize,min,max){
  const pool=[...new Set((ranked||[]).map(Number))].slice(0,topSize);
  const out=[];

  for(const n of shuffle(pool)){
    if(!out.includes(n)) out.push(n);
    if(out.length>=count) break;
  }

  while(out.length<count){
    const n=Math.floor(Math.random()*(max-min+1))+min;
    if(!out.includes(n)) out.push(n);
  }

  return out.sort((a,b)=>a-b);
}

function pickWeightedHistoricalReintegro(mode){
  const stats=getNumberStats('primitiva');
  const counts=stats?.extraCounts||{};

  const entries=Object.entries(counts)
    .map(([num,count])=>({num:Number(num),count:Number(count)}))
    .filter(x=>Number.isFinite(x.num));

  if(!entries.length) return randomReintegro();

  const values=entries.map(x=>x.num);
  const weights=entries.map(x=>x.count);

  const total=weights.reduce((a,b)=>a+b,0);
  let r=Math.random()*total;

  for(let i=0;i<values.length;i++){
    r-=weights[i];
    if(r<=0) return values[i];
  }

  return values[values.length-1];
}

function pickIaMain(game,count){
  const stats=getNumberStats(game);
  const merged=[
    ...(stats.hotMain||[]).slice(0,12),
    ...(stats.coldMain||[]).slice(0,12)
  ];
  return pickRandomFromTop(merged,count,18,1,game==='primitiva'?49:50);
}

export function generatePrimitiva(mode){

  let nums=[];

  if(mode==='Equilibrado') nums=[rand(1,9),rand(10,19),rand(20,29),rand(30,39),rand(40,45),rand(46,49)];
  if(mode==='Anti-fechas') nums=uniqueWeighted(1,49,6,n=>(n>=32?4:n>=20?1.5:0.5));
  if(mode==='Números raros') nums=uniqueWeighted(1,49,6,n=>(n>=35?4:n>=20?1.8:0.6));
  if(mode==='Alta dispersión') nums=[rand(1,6),rand(8,14),rand(17,24),rand(27,34),rand(37,43),rand(45,49)];

  if(mode==='Números calientes'){
    const stats=getNumberStats('primitiva');
    nums=pickRandomFromTop(stats.hotMain,6,18,1,49);
  }

  if(mode==='Números fríos'){
    const stats=getNumberStats('primitiva');
    nums=pickRandomFromTop(stats.coldMain,6,18,1,49);
  }

  if(mode==='Radar Loto IA'){
    nums=pickIaMain('primitiva',6);
  }

  nums=Array.from(new Set(nums));
  while(nums.length<6){
    const n=rand(1,49);
    if(!nums.includes(n)) nums.push(n);
  }

  nums.sort((a,b)=>a-b);

  if(mode!=='Equilibrado'&&(countConsecutive(nums)>0||maxEndingRepeat(nums)>2)){
    return generatePrimitiva(mode);
  }

  let reintegro=randomReintegro();

  if(mode==='Números calientes'){
    reintegro=pickWeightedHistoricalReintegro('Números calientes');
  }

  if(mode==='Números fríos'){
    reintegro=pickWeightedHistoricalReintegro('Números fríos');
  }

  if(mode==='Radar Loto IA'){
    reintegro=randomReintegro();
  }

  console.log('[RadarLoto IA DEBUG] mode=',mode,'reintegro=',reintegro);

  return{
    numbers:nums.map(pad2),
    reintegro
  };
}
