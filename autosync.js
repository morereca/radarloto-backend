import cron from 'node-cron';
import { runSyncAndEvaluate } from './sync.service.js';
import { refreshAllOfficialNumberStatsCache } from './services.officialStats.js';

let started = false;

export function startAutoSyncScheduler() {
  if (started) return;
  started = true;

  const expression = process.env.RADARLOTO_SYNC_CRON || '*/30 * * * *';
  const timezone = process.env.TZ || 'Europe/Madrid';

  console.log(`[autosync] Scheduler activo con expresión ${expression} (${timezone})`);

  cron.schedule(expression, async () => {
    try {
      const statsSummary = await refreshAllOfficialNumberStatsCache();
      console.log('[autosync] Stats oficiales actualizadas:', JSON.stringify(statsSummary));
      const summary = await runSyncAndEvaluate();
      console.log('[autosync] Sync automático completado:', JSON.stringify(summary));
    } catch (error) {
      console.error('[autosync] Error en sync automático:', error);
    }
  }, { scheduled: true, timezone });

  setTimeout(async () => {
    try {
      const statsSummary = await refreshAllOfficialNumberStatsCache();
      console.log('[autosync] Primera actualización de stats oficiales:', JSON.stringify(statsSummary));
      const summary = await runSyncAndEvaluate();
      console.log('[autosync] Primera sincronización completada:', JSON.stringify(summary));
    } catch (error) {
      console.error('[autosync] Error en la primera sincronización:', error);
    }
  }, 10000);
}
