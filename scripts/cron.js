import cron from 'node-cron';
import { spawn } from 'child_process';

const expression = process.env.RADARLOTO_CRON || '15 22 * * 2,4,5';
console.log(`Cron activo con expresión: ${expression}`);
console.log('Ejemplo por defecto: martes, jueves y viernes a las 22:15.');

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
