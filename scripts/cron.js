import cron from 'node-cron';
import { spawn } from 'child_process';

const expression = process.env.RADARLOTO_CRON || '*/30 * * * *';
console.log(`Cron activo con expresión: ${expression}`);
console.log('Ejemplo por defecto: cada 30 minutos.');

function runJob() {
  console.log('[cron] Lanzando sync y evaluación...');
  const child = spawn(process.execPath, ['scripts/syncAndEvaluate.js'], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    console.log(`[cron] Finalizado con código ${code}`);
  });
}

cron.schedule(expression, runJob, {
  scheduled: true,
  timezone: process.env.TZ || 'Europe/Madrid'
});

console.log('Scheduler iniciado. Déjalo corriendo para automatizar sorteos.');
