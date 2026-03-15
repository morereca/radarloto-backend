
import { db } from './db.js';

// SIMULACIÓN HISTÓRICA REAL
// compara la combinación generada contra todos los sorteos guardados

export function simulateHistorical(game, numbers, reintegro=null, stars=null){

  const draws = db.prepare(`
    SELECT numbers_json, stars_json, reintegro
    FROM draws
    WHERE game = ?
  `).all(game);

  let total = draws.length;

  let reintegroHits = 0;
  let hits3 = 0;
  let hits4 = 0;
  let hits5 = 0;
  let hits6 = 0;

  for(const draw of draws){

    const drawNumbers = JSON.parse(draw.numbers_json);

    let matches = 0;

    for(const n of numbers){
      if(drawNumbers.includes(Number(n))) matches++;
    }

    if(game === "primitiva"){

      if(reintegro !== null && Number(draw.reintegro) === Number(reintegro)){
        reintegroHits++;
      }

      if(matches === 3) hits3++;
      if(matches === 4) hits4++;
      if(matches === 5) hits5++;
      if(matches === 6) hits6++;

    }

  }

  return {
    totalDraws: total,
    prizes: reintegroHits + hits3 + hits4 + hits5 + hits6,
    reintegro: reintegroHits,
    hits3,
    hits4,
    hits5,
    hits6
  };
}
