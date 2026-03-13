export function evaluateTicket(ticket, draw) {
  const ticketNums = JSON.parse(ticket.numbers_json).map(Number);
  const drawNums = JSON.parse(draw.numbers_json).map(Number);
  const mainHits = ticketNums.filter((n) => drawNums.includes(n)).length;

  if (ticket.game === 'euromillones') {
    const ticketStars = JSON.parse(ticket.stars_json || '[]').map(Number);
    const drawStars = JSON.parse(draw.stars_json || '[]').map(Number);
    const starHits = ticketStars.filter((n) => drawStars.includes(n)).length;
    const label = labelEuromillones(mainHits, starHits);
    return {
      mainHits,
      starHits,
      reintegroHit: 0,
      label: label.label,
      detail: label.detail,
      won: label.won,
      prizeAmount: label.prizeAmount
    };
  }

  const reintegroHit = Number(ticket.reintegro === draw.reintegro ? 1 : 0);
  const label = labelPrimitiva(mainHits, reintegroHit);
  return {
    mainHits,
    starHits: 0,
    reintegroHit,
    label: label.label,
    detail: label.detail,
    won: label.won,
    prizeAmount: label.prizeAmount
  };
}

function labelEuromillones(mainHits, starHits) {
  const map = {
    '5-2': ['Habríamos dado 1ª categoría', '5 números + 2 estrellas', true, 'Premio variable'],
    '5-1': ['Habríamos dado 2ª categoría', '5 números + 1 estrella', true, 'Premio variable'],
    '5-0': ['Habríamos dado 3ª categoría', '5 números', true, 'Premio variable'],
    '4-2': ['Habríamos dado 4ª categoría', '4 números + 2 estrellas', true, 'Premio variable'],
    '4-1': ['Habríamos dado 5ª categoría', '4 números + 1 estrella', true, 'Premio variable'],
    '3-2': ['Habríamos dado 6ª categoría', '3 números + 2 estrellas', true, 'Premio variable'],
    '4-0': ['Habríamos dado 7ª categoría', '4 números', true, 'Premio variable'],
    '2-2': ['Habríamos dado 8ª categoría', '2 números + 2 estrellas', true, 'Premio variable'],
    '3-1': ['Habríamos dado 9ª categoría', '3 números + 1 estrella', true, 'Premio variable'],
    '3-0': ['Habríamos dado 10ª categoría', '3 números', true, 'Premio variable'],
    '1-2': ['Habríamos dado 11ª categoría', '1 número + 2 estrellas', true, 'Premio variable'],
    '2-1': ['Habríamos dado 12ª categoría', '2 números + 1 estrella', true, 'Premio variable'],
    '2-0': ['Habríamos dado 13ª categoría', '2 números', true, 'Premio variable']
  };
  const hit = map[`${mainHits}-${starHits}`];
  if (!hit) {
    return {
      label: 'Sin premio',
      detail: `${mainHits} números y ${starHits} estrellas`,
      won: false,
      prizeAmount: null
    };
  }
  return { label: hit[0], detail: hit[1], won: hit[2], prizeAmount: hit[3] };
}

function labelPrimitiva(mainHits, reintegroHit) {
  if (mainHits === 6 && reintegroHit === 1) {
    return { label: 'Habríamos dado categoría especial', detail: '6 números + reintegro', won: true, prizeAmount: 'Premio variable' };
  }
  if (mainHits === 6) {
    return { label: 'Habríamos dado 1ª categoría', detail: '6 números', won: true, prizeAmount: 'Premio variable' };
  }
  if (mainHits === 5) {
    return { label: 'Habríamos dado 3ª/2ª categoría según complementario', detail: '5 números', won: true, prizeAmount: 'Premio variable' };
  }
  if (mainHits === 4) {
    return { label: 'Habríamos dado 4ª categoría', detail: '4 números', won: true, prizeAmount: 'Premio variable' };
  }
  if (mainHits === 3) {
    return { label: 'Habríamos dado 5ª categoría', detail: '3 números', won: true, prizeAmount: 'Premio variable' };
  }
  if (reintegroHit === 1) {
    return { label: 'Habríamos dado reintegro', detail: 'Reintegro acertado', won: true, prizeAmount: 'Reintegro' };
  }
  return { label: 'Sin premio', detail: `${mainHits} números y reintegro ${reintegroHit ? 'sí' : 'no'}`, won: false, prizeAmount: null };
}