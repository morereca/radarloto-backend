
import { rand } from './utils.js';
import { getNumberStats } from './services.stats.js';

export function pickSmartPrimitivaReintegro(mode){
  const stats = getNumberStats('primitiva');

  const hot = (stats?.hotExtra || []).map(Number).filter(n=>!isNaN(n));
  const cold = (stats?.coldExtra || []).map(Number).filter(n=>!isNaN(n));

  let pool = [];

  if(mode === 'Números calientes'){
    pool = hot.slice(0,5);
  } else if(mode === 'Números fríos'){
    pool = cold.slice(0,5);
  } else if(mode === 'Radar Loto IA'){
    pool = [...new Set([...hot.slice(0,5), ...cold.slice(0,5)])];
  }

  if(pool.length === 0){
    return rand(0,9);
  }

  const i = rand(0, pool.length-1);
  return pool[i];
}
