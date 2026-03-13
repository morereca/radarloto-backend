import { runSyncAndEvaluate } from '../sync.service.js';

runSyncAndEvaluate()
  .then((summary) => {
    console.log('Sync y evaluación completados:', JSON.stringify(summary, null, 2));
  })
  .catch((e) => {
    console.error('Error en syncAndEvaluate:', e);
    process.exit(1);
  });
