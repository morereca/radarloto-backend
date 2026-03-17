import { db } from './db.js';

// SIMULACIÓN HISTÓRICA REAL
// Compara una combinación generada contra TODOS los sorteos guardados
// y devuelve un resumen claro, separado por tipo de resultado.
//
// Soporta:
// - La Primitiva: 6 números + reintegro opcional
// - Euromillones: 5 números + 2 estrellas
//
// NOTA:
// "realPrizes" cuenta solo resultados relevantes para mostrar en la UI
// sin inflar la métrica con coincidencias muy pequeñas.
// Si quieres, puedes cambiar ese criterio más adelante.

function safeJsonArray(value) {
  try {
    if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
    if (typeof value === 'string') return JSON.parse(value).map(Number).filter(Number.isFinite);
    return [];
  } catch {
    return [];
  }
}

function countMatches(a, b) {
  const setB = new Set(b.map(Number));
  return a.map(Number).filter((n) => setB.has(n)).length;
}

function sortNumbers(arr) {
  return [...arr].map(Number).filter(Number.isFinite).sort((x, y) => x - y);
}

function getPrimitivaPrizeLabel(matchesMain, reintegroHit = false) {
  if (matchesMain === 6) return '6 aciertos';
  if (matchesMain === 5) return '5 aciertos';
  if (matchesMain === 4) return '4 aciertos';
  if (matchesMain === 3) return '3 aciertos';
  if (reintegroHit) return 'Reintegro';
  return 'Sin premio';
}

function getEuromillonesPrizeLabel(matchesMain, matchesStars) {
  if (matchesMain === 5 && matchesStars === 2) return '5 números + 2 estrellas';
  if (matchesMain === 5 && matchesStars === 1) return '5 números + 1 estrella';
  if (matchesMain === 5 && matchesStars === 0) return '5 números';
  if (matchesMain === 4 && matchesStars === 2) return '4 números + 2 estrellas';
  if (matchesMain === 4 && matchesStars === 1) return '4 números + 1 estrella';
  if (matchesMain === 4 && matchesStars === 0) return '4 números';
  if (matchesMain === 3 && matchesStars === 2) return '3 números + 2 estrellas';
  if (matchesMain === 2 && matchesStars === 2) return '2 números + 2 estrellas';
  if (matchesMain === 3 && matchesStars === 1) return '3 números + 1 estrella';
  if (matchesMain === 3 && matchesStars === 0) return '3 números';
  if (matchesMain === 1 && matchesStars === 2) return '1 número + 2 estrellas';
  if (matchesMain === 2 && matchesStars === 1) return '2 números + 1 estrella';
  return 'Sin premio';
}

function isRelevantPrimitivaPrize(matchesMain) {
  // Ajustado para no inflar resultados en la UI.
  // Puedes cambiarlo a >=3 si quieres contar también premios pequeños.
  return matchesMain >= 4;
}

function isRelevantEuromillonesPrize(matchesMain, matchesStars) {
  // Ajustado para no inflar resultados en la UI.
  // Aquí contamos resultados de más entidad.
  if (matchesMain >= 4) return true;
  if (matchesMain === 3 && matchesStars >= 2) return true;
  return false;
}

function initBreakdown(game) {
  if (game === 'primitiva') {
    return {
      reintegro: 0,
      hits3: 0,
      hits4: 0,
      hits5: 0,
      hits6: 0,
    };
  }

  return {
    em_5_2: 0,
    em_5_1: 0,
    em_5_0: 0,
    em_4_2: 0,
    em_4_1: 0,
    em_4_0: 0,
    em_3_2: 0,
    em_2_2: 0,
    em_3_1: 0,
    em_3_0: 0,
    em_1_2: 0,
    em_2_1: 0,
  };
}

function updateEuromillonesBreakdown(breakdown, matchesMain, matchesStars) {
  const key = `em_${matchesMain}_${matchesStars}`;
  if (Object.prototype.hasOwnProperty.call(breakdown, key)) {
    breakdown[key] += 1;
  }
}

function buildBestResult(label, matchesMain, matchesExtra, drawDate) {
  return {
    label,
    matches_main: matchesMain,
    matches_extra: matchesExtra,
    draw_date: drawDate ?? null,
  };
}

function isBetterResult(candidateMain, candidateExtra, currentBest) {
  if (!currentBest) return true;
  if (candidateMain > currentBest.matches_main) return true;
  if (candidateMain === currentBest.matches_main && candidateExtra > currentBest.matches_extra) return true;
  return false;
}

export function simulateHistorical(game, numbers, reintegro = null, stars = null) {
  if (!['primitiva', 'euromillones'].includes(game)) {
    throw new Error('Juego no válido para simulación histórica');
  }

  const userNumbers = sortNumbers(numbers);
  const userStars = game === 'euromillones' ? sortNumbers(stars || []) : [];
  const userReintegro = game === 'primitiva' && reintegro !== null ? Number(reintegro) : null;

  if (game === 'primitiva' && userNumbers.length !== 6) {
    throw new Error('La Primitiva requiere 6 números');
  }

  if (game === 'euromillones' && (userNumbers.length !== 5 || userStars.length !== 2)) {
    throw new Error('Euromillones requiere 5 números y 2 estrellas');
  }

  const draws = db.prepare(`
    SELECT draw_date, numbers_json, stars_json, reintegro
    FROM draws
    WHERE game = ?
    ORDER BY draw_date DESC
  `).all(game);

  const breakdown = initBreakdown(game);

  let totalDraws = draws.length;
  let totalHits = 0;
  let realPrizes = 0;
  let bestResult = null;
  const sampleHits = [];

  for (const draw of draws) {
    const drawNumbers = safeJsonArray(draw.numbers_json);
    const matchesMain = countMatches(userNumbers, drawNumbers);

    if (game === 'primitiva') {
      const reintegroHit =
        userReintegro !== null &&
        draw.reintegro !== null &&
        draw.reintegro !== undefined &&
        Number(draw.reintegro) === userReintegro;

      const label = getPrimitivaPrizeLabel(matchesMain, reintegroHit);

      if (reintegroHit) breakdown.reintegro += 1;
      if (matchesMain === 3) breakdown.hits3 += 1;
      if (matchesMain === 4) breakdown.hits4 += 1;
      if (matchesMain === 5) breakdown.hits5 += 1;
      if (matchesMain === 6) breakdown.hits6 += 1;

      if (label !== 'Sin premio') {
        totalHits += 1;

        if (isRelevantPrimitivaPrize(matchesMain)) {
          realPrizes += 1;
        }

        if (isBetterResult(matchesMain, reintegroHit ? 1 : 0, bestResult)) {
          bestResult = buildBestResult(label, matchesMain, reintegroHit ? 1 : 0, draw.draw_date);
        }

        if (sampleHits.length < 25) {
          sampleHits.push({
            draw_date: draw.draw_date,
            label,
            matches_main: matchesMain,
            matches_extra: reintegroHit ? 1 : 0,
          });
        }
      }
    } else {
      const drawStars = safeJsonArray(draw.stars_json);
      const matchesStars = countMatches(userStars, drawStars);
      const label = getEuromillonesPrizeLabel(matchesMain, matchesStars);

      updateEuromillonesBreakdown(breakdown, matchesMain, matchesStars);

      if (label !== 'Sin premio') {
        totalHits += 1;

        if (isRelevantEuromillonesPrize(matchesMain, matchesStars)) {
          realPrizes += 1;
        }

        if (isBetterResult(matchesMain, matchesStars, bestResult)) {
          bestResult = buildBestResult(label, matchesMain, matchesStars, draw.draw_date);
        }

        if (sampleHits.length < 25) {
          sampleHits.push({
            draw_date: draw.draw_date,
            label,
            matches_main: matchesMain,
            matches_extra: matchesStars,
          });
        }
      }
    }
  }

  return {
    game,
    totalDraws,
    totalHits,
    realPrizes,
    bestResult,
    sampleHits,
    breakdown,
  };
}
