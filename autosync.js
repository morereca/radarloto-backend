import cron from 'node-cron';
import { runSyncAndEvaluate } from './sync.service.js';
import { importHistory } from './services.historyImport.js';
import { getDrawCoverage } from './services.stats.js';

let started = false;

export function startAutoSyncScheduler() {
  if (started) return;
  started = true;

  const expression = process.env.RADARLOTO_SYNC_CRON || '*/30 * * * *';
  const timezone = process.env.TZ || 'Europe/Madrid';

  console.log(`[autosync] Scheduler activo con expresión ${expression} (${timezone})`);

  cron.schedule(expression, async () => {
    try {
      const summary = await runSyncAndEvaluate();
      console.log('[autosync] Sync automático completado:', JSON.stringify(summary));
    } catch (error) {
      console.error('[autosync] Error en sync automático:', error);
    }
  }, { scheduled: true, timezone });

  setTimeout(async () => {
    try {
      const year = new Date().getFullYear();
      const covPrim = getDrawCoverage('primitiva');
      const covEuro = getDrawCoverage('euromillones');
      if (Number(covPrim.total || 0) < 50) {
        const importedPrim = await importHistory('primitiva', 2016, year);
        console.log('[autosync] Histórico base importado primitiva:', JSON.stringify(importedPrim));
      }
      if (Number(covEuro.total || 0) < 50) {
        const importedEuro = await importHistory('euromillones', 2016, year);
        console.log('[autosync] Histórico base importado euromillones:', JSON.stringify(importedEuro));
      }
      const summary = await runSyncAndEvaluate();
      console.log('[autosync] Primera sincronización completada:', JSON.stringify(summary));
    } catch (error) {
      console.error('[autosync] Error en la primera sincronización:', error);
    }
  }, 10000);
}
