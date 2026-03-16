import { getNumberStats } from './services.stats.js';
import { simulateHistorical } from './services.simulation.js';

export const MODES = [
  "RadarLoto IA",
  "Números calientes",
  "Números fríos"
];

function randomFromArray(arr){
  return arr[Math.floor(Math.random()*arr.length)];
}

function shuffle(array){
  return array.sort(()=>Math.random()-0.5);
}

function scoreEquilibrio(numbers){

  const pares = numbers.filter(n=>n%2===0).length;
  const impares = numbers.length - pares;

  const equilibrio = 100 - Math.abs(pares-impares)*10;

  return Math.max(0,Math.min(100,equilibrio));
}

function scoreCalidad(numbers){

  const sorted = [...numbers].sort((a,b)=>a-b);

  let dispersion = 0;

  for(let i=1;i<sorted.length;i++){
    dispersion += sorted[i]-sorted[i-1];
  }

  return Math.min(100,50+dispersion);
}

export function analyze(game, draw, mode){

  const equilibrio = scoreEquilibrio(draw.numbers);
  const calidad = scoreCalidad(draw.numbers);

  const simulation = simulateHistorical(
    game,
    draw.numbers.map(Number),
    game === "primitiva" ? draw.reintegro : null,
    game === "euromillones" ? draw.stars?.map(Number) : null
  );

  return {
    equilibrio,
    calidad,
    simulation
  };

}

export function generatePrimitiva(mode="RadarLoto IA"){

  const stats = getNumberStats("primitiva");

  let numbers;

  if(mode==="Números calientes"){

    numbers = shuffle(stats.hotMain.slice(0,20)).slice(0,6);

  }else if(mode==="Números fríos"){

    numbers = shuffle(stats.coldMain.slice(0,20)).slice(0,6);

  }else{

    numbers = shuffle([...Array(49).keys()].map(n=>n+1)).slice(0,6);

  }

  numbers = numbers.sort((a,b)=>a-b);

  const reintegro = Math.floor(Math.random()*10);

  return{
    numbers,
    reintegro
  };

}

export function generateEuromillones(mode="RadarLoto IA"){

  const stats = getNumberStats("euromillones");

  let numbers;

  if(mode==="Números calientes"){

    numbers = shuffle(stats.hotMain.slice(0,20)).slice(0,5);

  }else if(mode==="Números fríos"){

    numbers = shuffle(stats.coldMain.slice(0,20)).slice(0,5);

  }else{

    numbers = shuffle([...Array(50).keys()].map(n=>n+1)).slice(0,5);

  }

  numbers = numbers.sort((a,b)=>a-b);

  const stars = shuffle([...Array(12).keys()].map(n=>n+1)).slice(0,2);

  return{
    numbers,
    stars
  };

}
