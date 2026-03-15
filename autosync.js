import cron from 'node-cron';
import { runSyncAndEvaluate } from './sync.service.js';

let started = false;

function shouldRunNow(date = new Date()) {
  const day = date.getDay(); // 0=domingo, 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado
  const hour = date.getHours();

  // Ventanas aproximadas en España para revisar cerca de los sorteos
  // Primitiva: lunes, jueves, sábado
  // Euromillones: martes, viernes
  const primitivaDay = [1, 4, 6].includes(day);
  const euromillonesDay = [2, 5].includes(day);

  // revisa entre 20:00 y 23:59 y también una pasada de seguridad a las 00:00-01:59
  const inMainWindow = hour >= 20 && hour <= 23;
  const inSafetyWindow = hour >= 0 && hour <= 1;

  return (primitivaDay || euromillonesDay) && (inMainWindow || inSafetyWindow);
}

async function runAutoSync(reason = 'cron') {
  try {
    console.log(`[autosync] inicio (${reason}) ${new Date().toISOString()}`);
    const summary = await runSyncAndEvaluate();
    console.log('[autosync] ok', JSON.stringify(summary));
    return summary;
  } catch (error) {
    console.error('[autosync] error', error);
    return null;
  }
}

export function startAutoSyncScheduler() {
  if (started) {
    console.log('[autosync] scheduler ya iniciado');
    return;
  }
  started = true;

  // pasada al arrancar el servidor
  runAutoSync('startup');

  // cada 30 minutos
  cron.schedule('*/30 * * * *', async () => {
    const now = new Date();

    if (!shouldRunNow(now)) {
      console.log('[autosync] fuera de ventana de sorteo, se omite esta ejecución');
      return;
    }

    await runAutoSync('cron-30m');
  });

  console.log('[autosync] scheduler iniciado: revisión cada 30 minutos');
}
